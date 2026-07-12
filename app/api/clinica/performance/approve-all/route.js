import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Aprueba de golpe todos los incentivos pendientes de un periodo (por defecto, el
// último). Solo dirección. approvedIncentive := proposedIncentive.
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) return forbidden("Solo dirección puede aprobar incentivos");
  const { PerformanceMetric, TeamMember } = ctx.tenantModels;

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* sin body → último periodo */
  }

  let year;
  let month;
  if (body.period) {
    [year, month] = String(body.period).split("-").map(Number);
  } else {
    const latest = await PerformanceMetric.findOne({ order: [["periodYear", "DESC"], ["periodMonth", "DESC"]], attributes: ["periodYear", "periodMonth"], raw: true });
    if (!latest) return ok({ approved: 0 });
    year = latest.periodYear;
    month = latest.periodMonth;
  }

  let approvedById = null;
  const userId = request.headers.get("x-user-id");
  if (userId) {
    const tm = await TeamMember.findOne({ where: { userId } });
    approvedById = tm?.id ?? null;
  }

  const pending = await PerformanceMetric.findAll({ where: { periodYear: year, periodMonth: month, approvedIncentive: null } });
  const now = new Date();
  for (const m of pending) {
    await m.update({ approvedIncentive: m.proposedIncentive ?? 0, approvedById, approvedAt: now });
  }
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId,
    action: "clinica.performance.approve_all",
    entity: "PerformanceMetric",
    entityId: null,
    after: { period: `${year}-${String(month).padStart(2, "0")}`, approved: pending.length },
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ approved: pending.length, period: `${year}-${String(month).padStart(2, "0")}` });
});
