import { fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";
import {
  terapeutasDe, referenciaDe, conReferencia, listaDe, terapeutasEfectivos,
  sincronizarTerapeutas,
} from "../../../../lib/clinica/terapeutas.js";
import { normalizeConsents } from "../../../../lib/clinica/consents.js";
import { normalizeSpecialties, deriveCareType } from "../../../../lib/clinica/specialties.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
// ⚠️ `mainTherapistId` ya NO está aquí (25/08/2026): quién lleva al paciente
// pasó a ser una lista y lo escribe `sincronizarTerapeutas`, que además valida
// contra las fichas de equipo. Dejarlo en la lista blanca lo habría escrito por
// los dos caminos, y el último en pasar habría ganado.
const PATCH_FIELDS = [
  "firstName", "lastName", "age", "birthDate", "educationCenter", "educationLevel",
  "referralReason", "referredBy", "objectives", "enrollmentDate",
  "attendanceFrequency", "status", "dischargeDate", "dischargeReason", "notes",
  "dni", "address", "relationship", "contractSigned", "careType",
];

// Un tenant con módulo Clínica/Pacientes NO tiene por qué tener el módulo (ni la
// tabla) de clientes. El modelo Sequelize SIEMPRE está registrado, así que
// gatear por el modelo no protege: hay que gatear por hasModule("clients") y,
// además, degradar si la tabla/columna del pagador no existe (42P01/42703).
const isMissingRel = (err) => {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || code === "42703";
};

function therapistInclude(TeamMember) {
  return { model: TeamMember, as: "mainTherapist", attributes: ["id", "displayName", "position", "avatarColor"] };
}

// Include del cliente pagador + sus contactos (para mostrar en la ficha del
// paciente los contactos del que paga, sin duplicarlos). Sólo con módulo clients.
// Desde el 02/09/2026 también sus `guardians`: la ficha del paciente enseña a
// los padres y tutores de la familia (AV-0023 y AV-0024 de Aumenta), y el
// serializador los recorta antes de que salgan (sin DNI ni firmante).
function payerInclude({ Client, ClientContactMethod }, hasModule) {
  if (!hasModule("clients") || !Client) return [];
  const inc = { model: Client, as: "client", attributes: ["id", "name", "separated", "guardians"] };
  if (ClientContactMethod) {
    inc.include = [{ model: ClientContactMethod, as: "contactMethods", attributes: ["id", "kind", "value", "label", "isPrimary"] }];
  }
  return [inc];
}

// Carga el paciente con terapeuta + pagador; si el schema del tenant carece de la
// tabla/columna del pagador (42P01/42703), reintenta sin ese include (degradado
// limpio en vez de 500 — patrón exigido por schemas parciales del proyecto).
async function loadPatient(models, id, hasModule) {
  const { Patient, TeamMember, Client, ClientContactMethod } = models;
  const base = [therapistInclude(TeamMember)];
  const payer = payerInclude({ Client, ClientContactMethod }, hasModule);
  try {
    return await Patient.findByPk(id, { include: [...base, ...payer] });
  } catch (err) {
    if (payer.length && isMissingRel(err)) return Patient.findByPk(id, { include: base });
    throw err;
  }
}

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicSession } = ctx.tenantModels;
  const p = await loadPatient(ctx.tenantModels, id, ctx.hasModule);
  if (!p) return notFound("Paciente no encontrado");
  const agg = await ClinicSession.findOne({
    attributes: [[fn("COUNT", col("id")), "cnt"], [fn("MAX", col("session_date")), "last"]],
    where: { patientId: id },
    raw: true,
  });
  const equipo = await listaDe(ctx.tenantModels, ctx.tenantSequelize, [id]);
  return ok(serializePatient(p, {
    sessionsCount: Number(agg?.cnt ?? 0),
    lastSession: agg?.last ?? null,
    therapists: terapeutasEfectivos(p, equipo[id]),
  }));
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { Patient, Client } = ctx.tenantModels;
  const userId = request.headers.get("x-user-id");
  const p = await Patient.findByPk(id);
  if (!p) return notFound("Paciente no encontrado");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  const before = p.toJSON();
  const updates = {};
  for (const k of PATCH_FIELDS) if (k in body) updates[k] = body[k];
  if ("firstName" in updates && !String(updates.firstName ?? "").trim()) return error("Nombre obligatorio");
  if ("lastName" in updates && !String(updates.lastName ?? "").trim()) return error("Apellidos obligatorios");
  if ("objectives" in updates && !Array.isArray(updates.objectives)) updates.objectives = [];
  // Cap de VARCHAR (evita overflow) y coerción del check de contrato.
  if ("dni" in updates) updates.dni = cap(updates.dni, 20);
  if ("address" in updates) updates.address = cap(updates.address, 255);
  if ("relationship" in updates) updates.relationship = cap(updates.relationship, 60);
  if ("contractSigned" in updates) updates.contractSigned = !!updates.contractSigned;
  if ("careType" in updates && !["terapia", "nutricion"].includes(updates.careType)) return error("careType inválido");
  // Especialidades: normaliza y re-deriva el careType grueso (salvo que venga
  // uno explícito en la misma petición).
  if ("specialties" in body) {
    updates.specialties = normalizeSpecialties(body.specialties);
    if (!("careType" in body)) {
      const derived = deriveCareType(updates.specialties);
      if (derived) updates.careType = derived;
    }
  }

  // Cliente pagador: validar existencia; permitir desenlazar con null/"".
  if ("clientId" in body) {
    const raw = body.clientId;
    if (raw == null || raw === "") {
      updates.clientId = null;
    } else {
      if (!UUID_RE.test(String(raw))) return error("clientId inválido", 422);
      if (!Client) return error("Módulo clientes no disponible en este tenant", 422);
      const owner = await Client.findByPk(raw, { attributes: ["id"] });
      if (!owner) return error("El cliente indicado no existe", 422);
      updates.clientId = owner.id;
    }
  }

  // Consentimientos: merge con traza legal sobre los previos.
  if ("consents" in body) {
    updates.consents = normalizeConsents(body.consents, {
      previous: p.consents ?? {},
      userId,
      now: new Date().toISOString(),
    });
  }

  /*
   * ¿Habla el cuerpo de terapeutas? Tiene que preguntarse APARTE de `updates`:
   * la lista no es una columna de `patients` y no pasa por `PATCH_FIELDS`. Si no
   * se preguntara, cambiar SOLO los terapeutas caería en el corte de «sin
   * cambios» de aquí abajo y el endpoint devolvería 200 sin haber escrito nada
   * ni auditado nada. Es el fallo más caro que puede tener este handler, porque
   * la pantalla diría «guardado» y no sería verdad.
   */
  const tocaTerapeutas =
    "therapists" in body || "therapistIds" in body || "mainTherapistId" in body;

  // Sin cambios: devolver la MISMA forma que el GET (con terapeuta + pagador),
  // no el `p` sin includes (que blanquearía terapeuta/pagador en la respuesta).
  if (Object.keys(updates).length === 0 && !tocaTerapeutas) {
    const full = await loadPatient(ctx.tenantModels, id, ctx.hasModule);
    const eq = await listaDe(ctx.tenantModels, ctx.tenantSequelize, [id]);
    return ok(serializePatient(full ?? p, { therapists: terapeutasEfectivos(full ?? p, eq[id]) }));
  }

  // La lista de ANTES hay que leerla antes de tocar nada: no viaja en
  // `p.toJSON()` —vive en otra tabla— y sin ella la auditoría no sabría decir de
  // quién a quién se movió el paciente, que es justo lo que hay que poder mirar
  // cuando alguien pregunta por qué le cambió el reparto.
  const equipoAntes = tocaTerapeutas
    ? await listaDe(ctx.tenantModels, ctx.tenantSequelize, [id])
    : null;

  let movimiento = null;
  await ctx.tenantSequelize.transaction(async (transaction) => {
    if (Object.keys(updates).length > 0) await p.update(updates, { transaction });
    if (tocaTerapeutas) {
      // `mainTherapistId` suelto sube a esa persona al puesto 0, NO borra al
      // resto: la pantalla de alta todavía manda ese campo.
      const base = terapeutasDe(body) ?? terapeutasEfectivos(p, equipoAntes?.[id]).map((t) => ({
        id: t.teamMemberId,
        specialty: t.specialty,
      }));
      movimiento = await sincronizarTerapeutas({
        models: ctx.tenantModels,
        sequelize: ctx.tenantSequelize,
        paciente: p,
        entradas: conReferencia(base, referenciaDe(body)),
        transaction,
      });
    }
  });

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId,
    action: "pacientes.updated",
    entity: "Patient",
    entityId: id,
    // ⚠️ `auditSummary` y no `toJSON()` (25/08/2026). Esto escribe en
    // `master.audit_log`, que es de TODOS los clientes: la fila entera metía ahí
    // el motivo de derivación, las notas, el DNI, la dirección y los
    // consentimientos de un menor. La regla del proyecto es un RESUMEN, y el
    // helper que lo hace ya existía y ya lo usaba el alta.
    before: { ...auditSummary(before), therapistIds: movimiento?.antes ?? null },
    after: { ...auditSummary(p), therapistIds: movimiento?.despues ?? null },
    ip: request.headers.get("x-forwarded-for"),
  });
  // Recarga con terapeuta + pagador para devolver la misma forma que el GET
  // (degrada sin el pagador si el schema del tenant no lo tiene).
  const full = await loadPatient(ctx.tenantModels, id, ctx.hasModule);
  const equipo = await listaDe(ctx.tenantModels, ctx.tenantSequelize, [id]);
  return ok(serializePatient(full ?? p, { therapists: terapeutasEfectivos(full ?? p, equipo[id]) }));
});
