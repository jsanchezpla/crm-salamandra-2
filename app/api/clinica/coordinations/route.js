import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeCoordination } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const TYPES = ["family", "school", "psychiatrist", "neuropediatrician", "other_therapist", "orientator", "other"];
function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === "") return [];
  return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Coordination, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const where = {};
  if (sp.get("patientId")) where.relatedPatientId = sp.get("patientId");
  const rows = await Coordination.findAll({
    where,
    include: [{ model: TeamMember, as: "createdBy", attributes: ["id", "displayName", "position", "avatarColor"] }],
    order: [["coordinationDate", "DESC"]],
    limit: 300,
  });
  return ok({ coordinations: rows.map(serializeCoordination), total: rows.length });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Coordination } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!TYPES.includes(body.coordinationType)) return error("coordinationType inválido");
  if (!body?.createdById) return error("createdById es obligatorio");
  const payload = {
    coordinationType: body.coordinationType,
    coordinationDate: body.coordinationDate ? new Date(body.coordinationDate) : new Date(),
    participants: toArr(body.participants),
    topics: toArr(body.topics),
    agreements: toArr(body.agreements),
    nextActions: toArr(body.nextActions),
    relatedPatientId: body.relatedPatientId || null,
    createdById: body.createdById,
    // Cliente/pagador del paciente relacionado (foto al crear la coordinación).
    clientId: await clientIdOfPatient(ctx.tenantModels, body.relatedPatientId),
  };
  const c = await Coordination.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.coordination.created",
    entity: "Coordination",
    entityId: c.id,
    after: auditSummary(c),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeCoordination(c));
});
