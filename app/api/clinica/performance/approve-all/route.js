import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";
import { proposeIncentive, tiersFromTenant } from "../../../../../lib/clinica/incentives.js";
import { parsePeriodString } from "../../../../../lib/clinica/period.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Aprueba de golpe todos los incentivos pendientes de un periodo (por defecto, el
// último). Solo dirección. approvedIncentive := proposedIncentive.
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Rol fresco de BD (no el congelado del JWT): revocación de admin al instante.
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede aprobar incentivos");
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
    const parsed = parsePeriodString(body.period);
    if (!parsed) return error("Periodo inválido (usa YYYY-MM)");
    ({ year, month } = parsed);
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

  const tiers = tiersFromTenant(ctx.tenant);
  // Incentivos ESCRITOS del periodo: suman al importe aprobado de cada una.
  const { IncentiveItem } = ctx.tenantModels;
  const itemRows = await IncentiveItem.findAll({
    where: { periodYear: year, periodMonth: month },
    attributes: ["therapistId", "resolvedAmount"],
    raw: true,
  });
  const extrasByTherapist = {};
  for (const r of itemRows) {
    extrasByTherapist[r.therapistId] = (extrasByTherapist[r.therapistId] ?? 0) + (Number(r.resolvedAmount) || 0);
  }
  const pending = await PerformanceMetric.findAll({ where: { periodYear: year, periodMonth: month, approvedIncentive: null } });
  const now = new Date();
  for (const m of pending) {
    const extras = extrasByTherapist[m.therapistId] ?? 0;
    const total = Math.round((proposeIncentive(m.totalScore, tiers) + extras) * 100) / 100;
    await m.update({ approvedIncentive: total, approvedById, approvedAt: now });
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
