import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { computeProductivity } from "../../../../lib/clinica/productivity.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Citas que cuentan como intervención directa: agendadas y no anuladas.
const DIRECT_STATUSES = ["confirmed", "completed"];

/**
 * GET /api/clinica/productividad?period=YYYY-MM
 * Productividad del equipo en el mes: horas directas (suma de la duración de las
 * citas atendidas por cada profesional), horas disponibles (objetivo semanal
 * prorrateado a los laborables del mes) y su %.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Booking, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const period = sp.get("period");
  if (period) {
    [year, month] = period.split("-").map(Number);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return error("Periodo inválido (usa YYYY-MM)");
    }
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  // Minutos de intervención directa por profesional en el mes.
  const agg = await Booking.findAll({
    attributes: ["teamMemberId", [fn("SUM", col("duration")), "minutes"]],
    where: {
      teamMemberId: { [Op.ne]: null },
      status: { [Op.in]: DIRECT_STATUSES },
      scheduledAt: { [Op.gte]: start, [Op.lt]: end },
    },
    group: ["team_member_id"],
    raw: true,
  });
  const minutesByMember = Object.fromEntries(agg.map((r) => [r.teamMemberId, Number(r.minutes) || 0]));

  const members = await TeamMember.findAll({
    where: { status: "active" },
    attributes: ["id", "displayName", "position", "avatarColor", "weeklyDirectHours"],
    order: [["displayName", "ASC"]],
  });

  const rows = members.map((m) => {
    const prod = computeProductivity({
      directMinutes: minutesByMember[m.id] ?? 0,
      weeklyDirectHours: m.weeklyDirectHours,
      year,
      month,
    });
    return {
      therapistId: m.id,
      name: m.displayName,
      position: m.position ?? "",
      color: m.avatarColor ?? "#1B3A2D",
      weeklyDirectHours: m.weeklyDirectHours ?? null,
      directHours: prod.directHours,
      availableHours: prod.availableHours,
      pct: prod.pct,
    };
  });

  // Orden: por % descendente, los sin objetivo (null) al final.
  rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const withPct = rows.filter((r) => r.pct != null);
  const totalDirectHours = Math.round(rows.reduce((s, r) => s + (r.directHours || 0), 0) * 10) / 10;
  const teamPct = withPct.length ? Math.round(withPct.reduce((s, r) => s + r.pct, 0) / withPct.length) : null;
  const configuredCount = rows.filter((r) => r.weeklyDirectHours != null).length;

  return ok({
    period: { year, month, value: `${year}-${String(month).padStart(2, "0")}` },
    rows,
    totals: { totalDirectHours, teamPct, memberCount: rows.length, configuredCount },
  });
});
