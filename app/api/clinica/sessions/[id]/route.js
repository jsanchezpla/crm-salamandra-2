import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeSession } from "../../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const STATUSES = ["draft", "ai_pending", "registered", "published"];
const PATCH_FIELDS = ["sessionDate", "duration", "objectives", "activities", "performance", "observations", "status"];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicSession, TeamMember } = ctx.tenantModels;
  const s = await ClinicSession.findByPk(id, {
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
  });
  if (!s) return notFound("Sesión no encontrada");
  return ok(serializeSession(s));
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicSession } = ctx.tenantModels;
  const s = await ClinicSession.findByPk(id);
  if (!s) return notFound("Sesión no encontrada");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if ("status" in body && !STATUSES.includes(body.status)) return error("status inválido");
  const before = auditSummary(s); // solo identificadores: NO datos clínicos al log compartido
  const updates = {};
  for (const k of PATCH_FIELDS) if (k in body) updates[k] = body[k];
  if ("objectives" in updates && !Array.isArray(updates.objectives)) updates.objectives = [];
  if ("sessionDate" in updates && updates.sessionDate) updates.sessionDate = new Date(updates.sessionDate);
  if (Object.keys(updates).length === 0) return ok(serializeSession(s));
  await s.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.session.updated",
    entity: "ClinicSession",
    entityId: id,
    before,
    after: auditSummary(s),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializeSession(s));
});
