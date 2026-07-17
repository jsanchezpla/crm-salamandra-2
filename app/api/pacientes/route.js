import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden } from "../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../lib/clinica/audit.js";
import { normalizeConsents } from "../../../lib/clinica/consents.js";

const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Pacientes de un cliente pagador concreto (sección "Pacientes" de su ficha).
  // Un clientId presente pero malformado NO debe caer al listado completo.
  const clientId = sp.get("clientId");
  if (clientId) {
    if (!UUID_RE.test(clientId)) return error("clientId inválido", 422);
    where.clientId = clientId;
  }
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
  const { Patient, Client } = ctx.tenantModels;
  const userId = request.headers.get("x-user-id");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.firstName?.trim() || !body?.lastName?.trim()) return error("Nombre y apellidos son obligatorios");

  // Cliente pagador opcional. Si viene, debe existir en este tenant (evita
  // enlazar un paciente a un client_id inventado / de otro schema).
  let clientId = null;
  if (body.clientId != null && body.clientId !== "") {
    if (!UUID_RE.test(String(body.clientId))) return error("clientId inválido", 422);
    if (!Client) return error("Módulo clientes no disponible en este tenant", 422);
    const owner = await Client.findByPk(body.clientId, { attributes: ["id"] });
    if (!owner) return error("El cliente indicado no existe", 422);
    clientId = owner.id;
  }

  const payload = {
    clientId,
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
    // ── Datos personales / legales ──────────────────────────────────────
    dni: cap(body.dni, 20),
    address: cap(body.address, 255),
    relationship: cap(body.relationship, 60),
    consents: normalizeConsents(body.consents, { previous: {}, userId, now: new Date().toISOString() }),
    contractSigned: !!body.contractSigned,
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
