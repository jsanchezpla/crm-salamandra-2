import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeRankingRow } from "../../../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";
import { proposeIncentive, tiersFromTenant } from "../../../../../lib/clinica/incentives.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Aprobar / ajustar / desaprobar el incentivo de una métrica (solo dirección).
//   { action: "approve" }               → approvedIncentive = proposedIncentive
//   { action: "unapprove" }             → approvedIncentive = null
//   { approvedIncentive: <number> }     → importe ajustado
export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) return forbidden("Solo dirección puede aprobar incentivos");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { PerformanceMetric, TeamMember } = ctx.tenantModels;
  const m = await PerformanceMetric.findByPk(id);
  if (!m) return notFound("Métrica no encontrada");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  // La propuesta se deriva EN VIVO de la puntuación total y los tramos vigentes
  // (no del valor almacenado, que puede haber quedado desfasado si se editaron
  // los tramos después).
  const tiers = tiersFromTenant(ctx.tenant);
  let approvedIncentive;
  if (body.action === "approve") approvedIncentive = proposeIncentive(m.totalScore, tiers);
  else if (body.action === "unapprove") approvedIncentive = null;
  else if (body.approvedIncentive != null) {
    approvedIncentive = Number(body.approvedIncentive);
    if (!(approvedIncentive >= 0)) return error("Importe inválido");
  } else return error("Indica una acción (approve/unapprove) o un importe");

  let approvedById = null;
  const userId = request.headers.get("x-user-id");
  if (userId && approvedIncentive != null) {
    const tm = await TeamMember.findOne({ where: { userId } });
    approvedById = tm?.id ?? null;
  }

  const before = m.toJSON();
  await m.update({ approvedIncentive, approvedById: approvedIncentive == null ? null : approvedById, approvedAt: approvedIncentive == null ? null : new Date() });
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId,
    action: "clinica.performance.incentive",
    entity: "PerformanceMetric",
    entityId: id,
    before,
    after: m.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializeRankingRow(m, { tiers }));
});
