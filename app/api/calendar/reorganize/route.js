import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { reorganizeWeek } from "../../../../lib/calendar/reorganizeWeek.js";
import { getTenantAnthropicKey } from "../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../lib/ai/anthropicModel.js";
import { vetoAi } from "../../../../lib/ai/aiAccess.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// "Lun 27 jul" — etiqueta legible para la UI (UTC para no desplazar el día).
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const s = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dt);
  return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
}

// POST /api/calendar/reorganize — SIEMPRE devuelve 3 propuestas para repartir la semana.
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("calendar")) return forbidden("Módulo calendario no activo");
    const veto = await vetoAi(ctx, request, "reorganizar la semana con IA");
    if (veto) return veto;
    const { CalendarTask, TeamMember } = ctx.tenantModels;

    let body = {};
    try { body = await request.json(); } catch { /* opcional */ }
    const weekStart = typeof body?.weekStart === "string" && DATE_RE.test(body.weekStart) ? body.weekStart : null;
    if (!weekStart) return error("weekStart (YYYY-MM-DD) es obligatorio");
    const teamMemberId = typeof body?.teamMemberId === "string" && body.teamMemberId ? body.teamMemberId : null;
    const preferences = typeof body?.preferences === "string" ? body.preferences.slice(0, 300) : "";

    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const weekEnd = weekDates[6];

    const where = { startDate: { [Op.between]: [weekStart, weekEnd] }, status: "pending" };
    if (teamMemberId) where.teamMemberId = teamMemberId;
    const rows = await CalendarTask.findAll({
      where,
      attributes: ["id", "title", "priority", "startDate", "startTime", "endDate", "endTime", "allDay", "teamMemberId"],
      order: [["startDate", "ASC"], ["startTime", "ASC"]],
    });

    // Nombres de profesional (si hay tabla team_members).
    const nameById = {};
    if (TeamMember) {
      const ids = [...new Set(rows.map((r) => r.teamMemberId).filter(Boolean))];
      if (ids.length) {
        const tms = await TeamMember.findAll({ where: { id: ids }, attributes: ["id", "displayName"] });
        for (const t of tms) nameById[t.id] = t.displayName;
      }
    }
    const tasks = rows.map((r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority,
      startDate: String(r.startDate).slice(0, 10),
      startTime: r.startTime || null,
      endTime: r.endTime || null,
      allDay: !!r.allDay,
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
      teamMemberName: r.teamMemberId ? nameById[r.teamMemberId] : null,
    }));

    // La IA solo mueve tareas de UN SOLO día (mantiene la hora); las multi-día se dejan como están.
    const movable = tasks.filter((t) => !t.endDate || t.endDate === t.startDate);

    const apiKey = getTenantAnthropicKey(ctx);
    const model = getTenantAnthropicModel(ctx);
    let result;
    try {
      result = await reorganizeWeek({ tasks: movable, weekDates, apiKey, model, preferences, forceFake: ctx.slug === "demo" });
    } catch {
      result = { model: "sin-ia", proposals: [] };
    }

    // Enriquecer cada propuesta con título + día actual + profesional + etiquetas legibles.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const proposals = (result.proposals || []).map((p) => {
      const moves = (p.moves || [])
        .map((m) => {
          const t = byId.get(m.taskId);
          if (!t || t.startDate === m.newDate) return null;
          return {
            taskId: m.taskId,
            title: t.title,
            priority: t.priority,
            teamMemberName: t.teamMemberName || null,
            oldDate: t.startDate,
            newDate: m.newDate,
            oldLabel: dayLabel(t.startDate),
            newLabel: dayLabel(m.newDate),
            startTime: t.startTime,
            endTime: t.endTime,
            allDay: t.allDay,
            reason: m.reason,
          };
        })
        .filter(Boolean);
      return { key: p.key, title: p.title, description: p.description, moves };
    });

    return ok({
      proposals,
      model: result.model,
      weekStart,
      weekEnd,
      taskCount: movable.length,
    });
  } catch (err) {
    return serverError(err);
  }
});
