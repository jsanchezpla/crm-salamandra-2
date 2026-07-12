import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden } from "../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../lib/clinica/audit.js";

// El módulo clínico es una única superficie: Pacientes (el dato) + Clínica (las
// acciones). Se permite el acceso si el tenant tiene cualquiera de los dos.
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Nº de sesiones y fecha de la última por paciente, en una sola query agregada.
async function sessionAgg(ClinicSession, patientIds) {
  const map = {};
  if (patientIds.length === 0) return map;
  const rows = await ClinicSession.findAll({
    attributes: ["patientId", [fn("COUNT", col("id")), "cnt"], [fn("MAX", col("session_date")), "last"]],
    where: { patientId: { [Op.in]: patientIds } },
    group: ["patient_id"],
    raw: true,
  });
  for (const r of rows) map[r.patientId] = { sessionsCount: Number(r.cnt), lastSession: r.last };
  return map;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { Patient, ClinicSession, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  const where = {};
  const q = sp.get("q")?.trim();
  if (q) where[Op.or] = [{ firstName: { [Op.iLike]: `%${q}%` } }, { lastName: { [Op.iLike]: `%${q}%` } }];
  if (sp.get("therapistId")) where.mainTherapistId = sp.get("therapistId");
  const status = sp.get("status");
  if (status && ["active", "paused", "discharged"].includes(status)) where.status = status;

  const rows = await Patient.findAll({
    where,
    include: [{ model: TeamMember, as: "mainTherapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    order: [["lastName", "ASC"], ["firstName", "ASC"]],
    limit: 300,
  });
  const agg = await sessionAgg(ClinicSession, rows.map((r) => r.id));
  const patients = rows.map((p) => serializePatient(p, agg[p.id] ?? { sessionsCount: 0, lastSession: null }));
  return ok({ patients, total: patients.length });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { Patient } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.firstName?.trim() || !body?.lastName?.trim()) return error("Nombre y apellidos son obligatorios");

  const payload = {
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    age: body.age != null && body.age !== "" ? Number(body.age) : null,
    birthDate: body.birthDate || null,
    educationCenter: body.educationCenter?.trim() || null,
    educationLevel: body.educationLevel?.trim() || null,
    referralReason: body.referralReason?.trim() || null,
    referredBy: body.referredBy?.trim() || null,
    objectives: Array.isArray(body.objectives) ? body.objectives : [],
    mainTherapistId: body.mainTherapistId || null,
    enrollmentDate: body.enrollmentDate || null,
    attendanceFrequency: body.attendanceFrequency?.trim() || null,
    status: ["active", "paused", "discharged"].includes(body.status) ? body.status : "active",
    notes: body.notes?.trim() || null,
  };
  const p = await Patient.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "pacientes.created",
    entity: "Patient",
    entityId: p.id,
    after: p.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializePatient(p, { sessionsCount: 0, lastSession: null }));
});
