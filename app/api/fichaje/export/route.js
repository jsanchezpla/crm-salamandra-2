import { Op } from "sequelize";

import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { xlsxResponse } from "../../../../lib/billing/exportXlsx.js";
import { resumirPorPersona, rangoDelPeriodo } from "../../../../lib/fichaje/totales.js";
import { formatearMinutos } from "../../../../lib/fichaje/parseHora.js";

const ADMIN = new Set(["admin", "superadmin"]);

/**
 * GET /api/fichaje/export?mes=YYYY-MM — el mes en Excel.
 *
 * Los totales salen de `lib/fichaje/totales.js`, EL MISMO sitio del que salen
 * los de la pantalla. Es deliberado: si el Excel y la pantalla contaran por su
 * cuenta acabarían discrepando por un redondeo, y entonces no se fía nadie de
 * ninguno de los dos — que es el problema de las hojas de cálculo que este
 * módulo viene a sustituir.
 *
 * Dos hojas: el detalle fila a fila y el resumen por persona. La segunda es la
 * que se lleva a la gestoría.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    const mes = new URL(request.url).searchParams.get("mes");
    const rango = rangoDelPeriodo(mes);
    if (!rango) return error("Falta `mes` o no tiene formato YYYY-MM");

    const { Fichaje, TeamMember } = tenantModels;
    const [filas, personas] = await Promise.all([
      Fichaje.findAll({
        where: { fecha: { [Op.between]: [rango.desde, rango.hasta] }, deletedAt: null },
        order: [["fecha", "ASC"], ["entradaAt", "ASC"]],
      }),
      TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName", "email", "customFields"] }),
    ]);

    const nombre = new Map(personas.map((p) => [p.id, p.displayName]));
    const planas = filas.map((f) => f.toJSON());
    const resumen = resumirPorPersona(planas, personas);

    return await xlsxResponse({
      filename: `fichaje-${mes}.xlsx`,
      sheetName: "Resumen",
      columns: [
        { header: "Persona", key: "nombre", width: 30 },
        { header: "Días", key: "dias", width: 8 },
        { header: "Horas trabajadas", key: "horas", width: 18 },
        { header: "Horas previstas", key: "previstas", width: 18 },
        { header: "Diferencia", key: "diferencia", width: 14 },
        { header: "Correcciones a mano", key: "correcciones", width: 20 },
      ],
      rows: resumen.map((r) => ({
        nombre: r.nombre,
        dias: r.dias,
        horas: formatearMinutos(r.minutos),
        previstas: r.minutosPrevistos ? formatearMinutos(r.minutosPrevistos) : "—",
        diferencia: r.minutosPrevistos ? formatearMinutos(r.extras) : "—",
        correcciones: r.correcciones,
      })),
      filters: [
        { label: "Mes", value: mes },
        { label: "Jornadas", value: String(planas.length) },
        {
          label: "Ojo",
          value:
            "Las horas son las registradas y corregidas en el CRM. Las correcciones a mano llevan su motivo en la ficha de cada persona.",
        },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
