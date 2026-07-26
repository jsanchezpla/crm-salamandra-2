/**
 * Agregación de productividad del equipo (consulta a BD). Separado de
 * productivity.js para que ese quede puro (client-safe) y este pueda importar
 * Sequelize. Lo usan el endpoint /productividad y el /dashboard.
 */

import { Op, fn, col } from "sequelize";
import { computeProductivity } from "./productivity.js";

// Citas que cuentan como intervención directa: agendadas y no anuladas.
const DIRECT_STATUSES = ["confirmed", "completed"];

export async function aggregateTeamProductivity({ Booking, TeamMember, year, month }) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

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
  rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const withPct = rows.filter((r) => r.pct != null);
  const totalDirectHours = Math.round(rows.reduce((s, r) => s + (r.directHours || 0), 0) * 10) / 10;
  const teamPct = withPct.length ? Math.round(withPct.reduce((s, r) => s + r.pct, 0) / withPct.length) : null;
  const configuredCount = rows.filter((r) => r.weeklyDirectHours != null).length;

  return { rows, totals: { totalDirectHours, teamPct, memberCount: rows.length, configuredCount } };
}
