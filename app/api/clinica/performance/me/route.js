import { fn, col } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { serializePerformance, serializeTherapist } from "../../../../../lib/clinica/serialize.js";
import { tiersFromTenant } from "../../../../../lib/clinica/incentives.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Scorecard de desempeño de un terapeuta (?therapistId= o el ligado al usuario).
// SOLO DIRECCIÓN (decisión Aumenta 2026-07-24): el desempeño/incentivos no lo
// ven las terapeutas, ni siquiera el suyo propio. Soporta ?period=YYYY-MM.
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver el desempeño");
  const { PerformanceMetric, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  let therapistId = sp.get("therapistId");
  if (!therapistId) {
    const userId = request.headers.get("x-user-id");
    if (userId) {
      const tm = await TeamMember.findOne({ where: { userId } });
      if (tm) therapistId = tm.id;
    }
    if (!therapistId) {
      const first = await TeamMember.findOne({ where: { status: "active" }, order: [["createdAt", "ASC"]] });
      therapistId = first?.id ?? null;
    }
  }

  const therapists = (await TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"], order: [["displayName", "ASC"]] })).map((t) => ({ id: t.id, name: t.displayName }));
  if (!therapistId) return ok({ metric: null, therapist: null, therapists });

  const therapist = await TeamMember.findByPk(therapistId);
  const period = sp.get("period");
  let metric;
  if (period) {
    const [y, m] = period.split("-").map(Number);
    metric = await PerformanceMetric.findOne({ where: { therapistId, periodYear: y, periodMonth: m } });
  } else {
    metric = await PerformanceMetric.findOne({ where: { therapistId }, order: [["periodYear", "DESC"], ["periodMonth", "DESC"]] });
  }

  const histRows = await PerformanceMetric.findAll({
    where: { therapistId },
    attributes: ["periodMonth", "periodYear", "totalScore"],
    order: [["periodYear", "ASC"], ["periodMonth", "ASC"]],
    raw: true,
  });
  const history = histRows.slice(-6);

  let teamAverage = null;
  if (metric) {
    const avg = await PerformanceMetric.findOne({
      where: { periodYear: metric.periodYear, periodMonth: metric.periodMonth },
      attributes: [[fn("AVG", col("total_score")), "avg"]],
      raw: true,
    });
    teamAverage = avg?.avg != null ? Math.round(Number(avg.avg)) : null;
  }

  return ok({
    metric: metric ? serializePerformance(metric, { therapist, history, teamAverage, tiers: tiersFromTenant(ctx.tenant) }) : null,
    therapist: therapist ? serializeTherapist(therapist) : null,
    therapists,
  });
});
