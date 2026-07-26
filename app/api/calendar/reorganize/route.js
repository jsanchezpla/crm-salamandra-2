import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { reorganizeWeek } from "../../../../lib/calendar/reorganizeWeek.js";
import { getTenantAnthropicKey } from "../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../lib/ai/anthropicModel.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// POST /api/calendar/reorganize — propone mover tareas de la semana para repartir carga.
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("calendar")) return forbidden("Módulo calendario no activo");
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
      attributes: ["id", "title", "priority", "startDate", "startTime", "endDate", "allDay", "teamMemberId"],
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
      allDay: !!r.allDay,
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
      teamMemberName: r.teamMemberId ? nameById[r.teamMemberId] : null,
    }));

    // La IA solo mueve tareas de UN SOLO día (mantiene la hora); las multi-día se dejan como están.
    const movable = tasks.filter((t) => !t.endDate || t.endDate === t.startDate);
    if (movable.length < 2) {
      return ok({ moves: [], model: "none", note: "La semana no está saturada (o no hay tareas de un día que reorganizar)." });
    }

    const apiKey = getTenantAnthropicKey(ctx);
    const model = getTenantAnthropicModel(ctx);
    let result;
    try {
      result = await reorganizeWeek({ tasks: movable, weekDates, apiKey, model, preferences });
    } catch {
      result = { model: "sin-ia", moves: [] };
    }

    // Enriquecer con título + día actual para la UI (y descartar no-moves).
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const moves = (result.moves || [])
      .map((m) => {
        const t = byId.get(m.taskId);
        if (!t || t.startDate === m.newDate) return null;
        return { taskId: m.taskId, title: t.title, priority: t.priority, oldDate: t.startDate, newDate: m.newDate, startTime: t.startTime, allDay: t.allDay, reason: m.reason };
      })
      .filter(Boolean);

    return ok({ moves, model: result.model, weekStart, weekEnd, note: moves.length === 0 ? "La semana ya está equilibrada; no hace falta mover nada." : undefined });
  } catch (err) {
    return serverError(err);
  }
});
