import { esEstadoDeFicha } from "../../../../lib/clients/estados.js";
import { filtroDeVisibilidad } from "../../../../lib/clients/consultaExterna.js";
import { rotuloCategoria } from "../../../../lib/booking/categorias.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { forbidden } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";
import ExcelJS from "exceljs";

const STATUS_LABELS = {
  new: "Nuevo",
  contacted: "Contactado",
  following: "En seguimiento",
  converted: "Convertido",
  discarded: "Descartado",
};

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const status = searchParams.get("status");
  const country = searchParams.get("country");
  const search = searchParams.get("search");
  // Qué es el contratante (festival, sala, ayuntamiento…). La pantalla YA lo
  // mandaba —con un comentario que decía que bajar «festivales» y recibir los
  // 183 sería una sorpresa cara— y este fichero no lo leía: la sorpresa estaba
  // pasando (28/08/2026).
  const categoria = searchParams.get("categoria");

  // El mismo filtro por estado de ficha que el listado: si el Excel no lo
  // respetara, exportar «los que no vinieron» daría la cartera entera.
  const estado = searchParams.get("estado");
  if (esEstadoDeFicha(estado)) where.status = String(estado).trim();
  // Los filtros de `customFields` se juntan en UN solo `Op.contains`, igual que
  // en el listado: escritos como `if` encadenados, cada filtro nuevo duplicaba
  // las combinaciones y siempre se quedaba alguna sin escribir.
  const enCustomFields = {};
  if (status) enCustomFields.seStatus = status;
  if (country) enCustomFields.country = country;
  if (categoria) enCustomFields.categoria = categoria;
  if (Object.keys(enCustomFields).length) {
    where.customFields = { [Op.contains]: enCustomFields };
  }

  /*
   * Todas las palabras, cada una en cualquiera de los campos (28/08/2026). Antes
   * se buscaba la frase entera dentro de cada columna, así que «castro hugo» o
   * «hugo díaz» no encontraban a «Hugo Castro Díaz», ni «diaz» sin tilde. El
   * porqué, en `lib/utils/busqueda.js`.
   */
  if (search) {
    // Se busca también por teléfono, como en la lista: si el Excel busca
    // distinto que la pantalla, trae filas que no se estaban viendo.
    const porNombre = await filtroPorNombre(Client.sequelize, search, [
      "Client.name", "Client.email", "Client.phone",
    ]);
    if (porNombre) (where[Op.and] ||= []).push(porNombre);
  }

  /*
   * «Consultas externas»: el Excel NO lo respetaba y la lista sí (28/08/2026).
   * Era una puerta lateral a la regla de Rodrigo del 07/08/2026 —esos pacientes
   * solo los ven admin y quien los lleva—: cualquiera con el módulo podía
   * bajarse un Excel con los de otra profesional. Hoy no hay ni una ficha
   * marcada como externa en producción, así que no se ha escapado nada; se
   * cierra antes de que la haya.
   */
  const rolQuienMira = request.headers.get("x-user-role") ?? "user";
  const soyDelEquipo = hasModule("team") ? await resolveCurrentTeamMemberId(request, tenantModels) : null;
  const filtroExternas = filtroDeVisibilidad(rolQuienMira, soyDelEquipo);
  const whereFinal = filtroExternas ? { [Op.and]: [where, filtroExternas] } : where;

  const clients = await Client.findAll({ where: whereFinal, order: [["createdAt", "DESC"]] });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Salamandra";
  const sheet = workbook.addWorksheet("Clientes");

  /*
   * La columna «Tipo», solo donde significa algo (01/09/2026, Rodrigo).
   *
   * Desde el 28/08/2026 este Excel FILTRA por tipo pero no lo sacaba: bajabas
   * «festivales» y el fichero no decía de ninguna fila que lo fuera, así que
   * fuera del CRM —que es a lo que va un Excel— el dato se perdía. Va detrás de
   * Empresa, en el mismo orden que la pantalla (Contratante · Tipo · Email).
   *
   * Gateada por `booking` como en la lista: una columna vacía en las 1.083
   * fichas de un centro clínico es una pregunta que nadie hizo.
   */
  const conCategoria = hasModule("booking");

  sheet.columns = [
    { header: "Nombre", key: "name", width: 25 },
    { header: "Empresa", key: "company", width: 28 },
    ...(conCategoria ? [{ header: "Tipo", key: "tipo", width: 18 }] : []),
    { header: "Email", key: "email", width: 30 },
    { header: "Teléfono", key: "phone", width: 15 },
    { header: "País", key: "country", width: 18 },
    { header: "Ciudad", key: "city", width: 18 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Origen", key: "origin", width: 12 },
    { header: "Fecha creación", key: "createdAt", width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0047AB" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  for (const c of clients) {
    sheet.addRow({
      name: c.name || "",
      company: c.customFields?.company || "",
      // El rótulo humano, no la clave: en la base vive `sala` y aquí se lee
      // «Sala / club», lo mismo que en la columna de la pantalla. Sin tipo va
      // vacía y no el «—» de la lista: en una hoja de cálculo ese guión es
      // texto, y ordenar o filtrar por esa columna lo pondría por delante.
      ...(conCategoria
        ? { tipo: c.customFields?.categoria ? rotuloCategoria(c.customFields.categoria) : "" }
        : {}),
      email: c.email || "",
      phone: c.phone || "",
      country: c.customFields?.country || "",
      city: c.customFields?.city || "",
      status: STATUS_LABELS[c.customFields?.seStatus] ?? c.customFields?.seStatus ?? "",
      notes: c.notes || "",
      origin: c.customFields?.origin || "",
      createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-ES") : "",
    });
  }

  for (let i = 2; i <= clients.length + 1; i++) {
    const row = sheet.getRow(i);
    row.height = 18;
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    });
    if (i % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fecha = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="clientes_${fecha}.xlsx"`,
    },
  });
});
