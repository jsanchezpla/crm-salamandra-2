import { fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const PATCH_FIELDS = [
  "firstName", "lastName", "age", "birthDate", "educationCenter", "educationLevel",
  "referralReason", "referredBy", "objectives", "mainTherapistId", "enrollmentDate",
  "attendanceFrequency", "status", "dischargeDate", "dischargeReason", "notes",
];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { Patient, ClinicSession, TeamMember } = ctx.tenantModels;
  const p = await Patient.findByPk(id, {
    include: [{ model: TeamMember, as: "mainTherapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
  });
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
  const { Patient } = ctx.tenantModels;
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
  if (Object.keys(updates).length === 0) return ok(serializePatient(p));

  await p.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "pacientes.updated",
    entity: "Patient",
    entityId: id,
    before,
    after: p.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializePatient(p));
});
