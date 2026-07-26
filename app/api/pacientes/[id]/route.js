import { fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../../lib/clinica/audit.js";
import { normalizeConsents } from "../../../../lib/clinica/consents.js";
import { normalizeSpecialties, deriveCareType } from "../../../../lib/clinica/specialties.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const PATCH_FIELDS = [
  "firstName", "lastName", "age", "birthDate", "educationCenter", "educationLevel",
  "referralReason", "referredBy", "objectives", "mainTherapistId", "enrollmentDate",
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
function payerInclude({ Client, ClientContactMethod }, hasModule) {
  if (!hasModule("clients") || !Client) return [];
  const inc = { model: Client, as: "client", attributes: ["id", "name", "separated"] };
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
  return ok(serializePatient(p, { sessionsCount: Number(agg?.cnt ?? 0), lastSession: agg?.last ?? null }));
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

  // Sin cambios: devolver la MISMA forma que el GET (con terapeuta + pagador),
  // no el `p` sin includes (que blanquearía terapeuta/pagador en la respuesta).
  if (Object.keys(updates).length === 0) {
    const full = await loadPatient(ctx.tenantModels, id, ctx.hasModule);
    return ok(serializePatient(full ?? p));
  }

  await p.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId,
    action: "pacientes.updated",
    entity: "Patient",
    entityId: id,
    before,
    after: p.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });
  // Recarga con terapeuta + pagador para devolver la misma forma que el GET
  // (degrada sin el pagador si el schema del tenant no lo tiene).
  const full = await loadPatient(ctx.tenantModels, id, ctx.hasModule);
  return ok(serializePatient(full ?? p));
});
