import { promises as fs } from "node:fs";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { puedeVerFicha, normalizarCategoria, veTodasLasExternas } from "../../../../lib/clients/consultaExterna.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { getClientDir } from "../../../../lib/clients/attachmentStorage.js";
import { borrarRastroDelCliente } from "../../../../lib/clients/borrarRastro.js";
import { entradaDeCliente } from "../../../../lib/clients/listaEspera.js";
import { fechaONull } from "../../../../lib/clients/formularioAlta.js";
import { bonosDeCliente } from "../../../../lib/citas/packs.js";
import {
  normalizeContactValue,
  validateContactValue,
  setPrimaryContactValue,
  isMissingTable,
} from "../../../../lib/clients/contactMethods.js";

export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Interaction, WaitlistEntry } = tenantModels;
  const { id } = await params;

  // Si la familia está esperando plaza, la ficha lo dice en su primera
  // pantalla: es lo que pregunta cualquiera que la abra («¿desde cuándo llevan
  // esperando?»), y hasta ahora había que ir a otra pantalla a buscarlo.
  const enCola = hasModule("clients_avanzado") ? await entradaDeCliente(WaitlistEntry, id) : null;
  const listaEspera = enCola
    ? { desde: enCola.createdAt, posicion: enCola.position, id: enCola.id }
    : null;

  // Intento principal: cliente + interactions (timeline legacy usado por el
  // ClientDetailModule default). Si la tabla `interactions` no existe en el
  // schema del tenant (sucede p. ej. en crm_nutri_laura, donde el módulo
  // legacy nunca se sembró) → Postgres devuelve 42P01 "undefined_table" y
  // Sequelize lo envuelve en SequelizeDatabaseError. En ese caso degradamos
  // a un fetch sin include y devolvemos interactions:[] para no romper la
  // ficha completa por una sección opcional.
  let client;
  try {
    client = await Client.findByPk(id, {
      include: [{ model: Interaction, as: "interactions", order: [["date", "DESC"]] }],
    });
  } catch (err) {
    const isMissingTable =
      err?.parent?.code === "42P01" ||
      err?.original?.code === "42P01";
    if (!isMissingTable) throw err;
    process.stderr.write(
      `[clients:detail] interactions table missing for tenant ${tenant.slug} — degrading to no-include\n`
    );
    client = await Client.findByPk(id);
    if (client) {
      // Sequelize no añade el alias 'interactions' si no hay include; lo
      // emulamos en el JSON serializado para que el cliente reciba siempre
      // la misma forma (default module lee data.data.interactions).
      const json = client.toJSON();
      json.interactions = [];
      json.listaEspera = listaEspera;
      json.bonos = await bonosDeCliente(tenantModels, client);
      return ok(json);
    }
  }

  if (!client) return notFound("Cliente no encontrado");

  /*
   * «Consulta externa»: solo admin y quien la tenga asignada (07/08/2026). Se
   * comprueba AQUÍ y no solo en el listado porque esto se pide por id: filtrar
   * la lista sin cerrar el detalle deja la ficha accesible con la URL a mano.
   *
   * Se devuelve 404 y no 403: decir «existe pero no es para ti» ya cuenta algo
   * de un paciente que no le corresponde a quien pregunta.
   */
  const rolQuienMira = request.headers.get("x-user-role") ?? "user";
  const soyDelEquipo = hasModule("team") ? await resolveCurrentTeamMemberId(request, tenantModels) : null;
  if (!puedeVerFicha(client, rolQuienMira, soyDelEquipo)) return notFound("Cliente no encontrado");

  // Bonos de sesiones y lo que le queda de cada uno (04/08/2026). Devuelve []
  // en cuanto falte algo: la ficha no se cae por una sección de más.
  const bonos = await bonosDeCliente(tenantModels, client);
  return ok({ ...client.toJSON(), listaEspera, bonos });
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, ClientContactMethod } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  // ARREGLO 2026-07-22: este bloque solo contemplaba ocho claves con nombre
  // propio, así que un `customFields` enviado por la UI con cualquier otra
  // (edad, motivo, info_adicional… las que usa la ficha de nutrición) se
  // perdía EN SILENCIO: la pantalla decía "guardado" y el valor no cambiaba.
  // Ahora se admite el objeto entero y las claves con nombre siguen mandando
  // encima, así que el comportamiento anterior no varía para nadie.
  const entrantes =
    body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
      ? body.customFields
      : {};
  const base = { ...client.customFields, ...entrantes };

  const customFields = {
    ...base,
    company: body.company?.trim() ?? base.company ?? null,
    country: body.country?.trim() ?? base.country ?? null,
    city: body.city?.trim() ?? base.city ?? null,
    postalCode: body.postalCode?.trim() ?? base.postalCode ?? null,
    // Domicilio (04/08/2026): línea de texto, no `Client.address` (JSONB).
    domicilio: body.domicilio?.trim() ?? base.domicilio ?? null,
    origin: body.origin ?? base.origin ?? "manual",
    leadId: body.leadId ?? base.leadId ?? null,
    seStatus: body.status ?? base.seStatus ?? "new",
  };

  // Datos fiscales (solo si vienen explícitos en el body)
  const fiscalUpdates = {};
  for (const k of ["fiscalName", "fiscalAddress", "fiscalCity", "fiscalZip", "fiscalCountry", "taxId"]) {
    if (k in body) {
      const v = body[k];
      fiscalUpdates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }

  // El campo email/teléfono único de la ficha edita el CONTACTO PRINCIPAL: sólo
  // se toca si viene un valor no vacío (compat con el "|| client.email" legacy).
  const emailN = normalizeContactValue("email", body.email);
  const phoneN = normalizeContactValue("phone", body.phone);
  if (emailN) {
    const invalid = validateContactValue("email", emailN);
    if (invalid) return error(invalid, 422);
  }

  const baseUpdate = {
    name: body.name?.trim() || client.name,
    notes: "notes" in body ? (body.notes?.trim() || null) : client.notes,
    customFields,
    ...fiscalUpdates,
  };
  // Fecha de nacimiento (04/08/2026). Solo si viene explícita, como los datos
  // fiscales: un PUT parcial de otra sección no puede borrarla por omisión.
  if ("birthDate" in body) baseUpdate.birthDate = fechaONull(body.birthDate);
  // Flag "padres separados" (tutor). Sólo se toca si viene explícito en el body
  // (permite un PUT parcial { separated } sin arrastrar el resto de campos).
  if ("separated" in body) baseUpdate.separated = body.separated == null ? null : !!body.separated;
  // Citas autoconfirmadas para ESTA persona (06/08/2026, Rodrigo). Igual que
  // arriba: solo si viene explícito, para que un guardado de otra sección de la
  // ficha no lo apague sin querer.
  if ("autoConfirmBookings" in body) baseUpdate.autoConfirmBookings = !!body.autoConfirmBookings;

  /*
   * «Consulta externa» y su empresa (07/08/2026, Rodrigo). Solo si vienen
   * explícitos, como el resto: un guardado de otra sección de la ficha no puede
   * desmarcarlo sin querer — y desmarcarlo significa que el paciente aparece de
   * golpe para todo el equipo.
   *
   * ⚠️ SOLO ADMIN PUEDE MARCARLO O QUITARLO. Es lo que decide quién ve a esa
   * persona; si lo pudiera cambiar cualquiera, la regla de visibilidad no
   * valdría nada. La categoría sí la puede tocar quien ya ve la ficha: es una
   * etiqueta, no un permiso.
   */
  const rolQuienEdita = request.headers.get("x-user-role") ?? "user";
  if ("esConsultaExterna" in body) {
    if (!veTodasLasExternas(rolQuienEdita)) {
      return error("Solo un administrador puede marcar una consulta externa", 403);
    }
    baseUpdate.esConsultaExterna = !!body.esConsultaExterna;
  }
  if ("categoriaExterna" in body) baseUpdate.categoriaExterna = normalizarCategoria(body.categoriaExterna);

  // Transacción: datos base + upsert del principal (email/phone) → espejo en
  // Client.email/phone. Si el tenant aún no tiene client_contact_methods (42P01),
  // la tx hace rollback y degradamos a un update directo (comportamiento legacy).
  try {
    await tenantSequelize.transaction(async (t) => {
      await client.update(baseUpdate, { transaction: t });
      if (emailN) await setPrimaryContactValue({ client, ClientContactMethod, kind: "email", value: emailN, transaction: t });
      if (phoneN) await setPrimaryContactValue({ client, ClientContactMethod, kind: "phone", value: phoneN, transaction: t });
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    await client.update({
      ...baseUpdate,
      email: emailN ?? client.email,
      phone: phoneN ?? client.phone,
    });
  }

  await client.reload();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "client.updated",
    entity: "Client",
    entityId: client.id,
    after: resumen(client, ["name", "email", "phone", "type", "status"]),
  });
  return ok(client);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Invoice } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  // No permitir borrar si tiene facturas (preservar histórico fiscal).
  // Si la tabla `invoices` no existe en este tenant (caso nutri_laura, donde
  // el módulo billing no se sembró) → Postgres devuelve 42P01. Degradamos
  // a "no hay bloqueo por facturas" y seguimos con el borrado: el cliente
  // claramente no puede tener facturas si la tabla no existe. Mismo patrón
  // defensivo que el GET con `interactions`.
  if (Invoice) {
    try {
      const invoiceCount = await Invoice.count({ where: { clientId: id } });
      if (invoiceCount > 0) {
        return error(`No se puede borrar: el cliente tiene ${invoiceCount} factura(s). Márcalo como inactivo en su lugar.`, 409);
      }
    } catch (err) {
      const isMissingTable =
        err?.parent?.code === "42P01" ||
        err?.original?.code === "42P01";
      if (!isMissingTable) throw err;
      process.stderr.write(
        `[clients:delete] invoices table missing for tenant ${tenant.slug} — skipping invoice guard\n`
      );
    }
  }

  // Borrar un cliente se lleva por delante sus adjuntos y su historial:
  // tiene que quedar constancia de quién lo hizo.
  const antesBorrar = resumen(client, ["name", "email", "phone", "type", "status"]);
  const idBorrado = client.id;

  // ANTES de destruir la ficha, no después: al borrarla, los documentos y las
  // citas se quedan con la FK a NULL y ya no hay forma de saber de quién eran.
  const rastro = await borrarRastroDelCliente({
    tenantModels,
    tenant,
    clientId: client.id,
    clientEmail: client.email,
  });

  await client.destroy();

  // GC del directorio físico de adjuntos. El CASCADE ya borró client_attachments
  // en BD pero los archivos en disco quedarían huérfanos. Best-effort: si la
  // limpieza falla, el cliente queda borrado igual y el GC periódico (apuntado
  // al backlog) se encargará de los huérfanos.
  try {
    const dir = getClientDir(tenant.slug, id);
    await fs.rm(dir, { recursive: true, force: true });
    process.stdout.write(`[clients:attachment] cleanup dir tenant=${tenant.slug} client=${id}\n`);
  } catch (err) {
    process.stderr.write(`[clients:attachment] cleanup dir failed: ${err.message}\n`);
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "client.deleted",
    entity: "Client",
    entityId: idBorrado,
    before: antesBorrar,
    // Cuánto se llevó por delante. Sin esto, un borrado que se lleva 14
    // documentos y 3 citas queda en el registro igual que uno que no se lleva
    // nada, y luego no hay forma de reconstruir qué pasó.
    after: {
      documentosBorrados: rastro.documentos,
      citasFuturasBorradas: rastro.citasFuturas,
      citasAvisadas: rastro.avisadas,
    },
  });
  return noContent();
});
