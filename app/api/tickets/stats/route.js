import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { ACTIVE_STATUSES } from "@/lib/support/context.js";

/**
 * GET /api/tickets/stats?months=6 — informes del módulo Soporte.
 *
 * Devuelve series por mes (creados / resueltos), tiempos medios de primera
 * respuesta y resolución, % dentro de SLA, y reparto por categoría y por
 * responsable. Todo calculado en SQL sin inputs del usuario (months va
 * saneado a entero 1..24).
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const { Ticket, TicketCategory, TeamMember } = ctx.tenantModels;
    const sq = Ticket.sequelize;

    const sp = new URL(request.url).searchParams;
    const months = Math.min(Math.max(Number(sp.get("months")) || 6, 1), 24);
    const desde = new Date();
    desde.setMonth(desde.getMonth() - (months - 1));
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const mes = (col) => sq.fn("to_char", sq.fn("date_trunc", "month", sq.col(col)), "YYYY-MM");

    const [creadosMes, resueltosMes, tiempos, slaFilas, porCategoria, porResponsable, actuales, porPrioridad] =
      await Promise.all([
        Ticket.findAll({
          attributes: [[mes("created_at"), "mes"], [sq.fn("COUNT", sq.col("id")), "n"]],
          where: { createdAt: { [Op.gte]: desde } },
          group: [mes("created_at")],
          raw: true,
        }),
        Ticket.findAll({
          attributes: [[mes("resolved_at"), "mes"], [sq.fn("COUNT", sq.col("id")), "n"]],
          where: { resolvedAt: { [Op.gte]: desde } },
          group: [mes("resolved_at")],
          raw: true,
        }),
        Ticket.findAll({
          attributes: [
            [sq.literal(`AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600)`), "avgFirstResponse"],
            [sq.literal(`AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)`), "avgResolution"],
          ],
          where: { createdAt: { [Op.gte]: desde } },
          raw: true,
        }),
        Ticket.findAll({
          attributes: [
            [sq.literal(`COUNT(*) FILTER (WHERE first_response_due_at IS NOT NULL AND first_response_at IS NOT NULL)`), "frTotal"],
            [sq.literal(`COUNT(*) FILTER (WHERE first_response_due_at IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= first_response_due_at)`), "frOk"],
            [sq.literal(`COUNT(*) FILTER (WHERE resolution_due_at IS NOT NULL AND resolved_at IS NOT NULL)`), "rsTotal"],
            [sq.literal(`COUNT(*) FILTER (WHERE resolution_due_at IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at <= resolution_due_at)`), "rsOk"],
          ],
          where: { createdAt: { [Op.gte]: desde } },
          raw: true,
        }),
        Ticket.findAll({
          attributes: ["categoryId", [sq.fn("COUNT", sq.col("Ticket.id")), "n"]],
          include: [{ model: TicketCategory, as: "category", attributes: ["name", "color"], required: false }],
          where: { createdAt: { [Op.gte]: desde } },
          group: ["Ticket.category_id", "category.id", "category.name", "category.color"],
          raw: true,
          nest: true,
        }),
        Ticket.findAll({
          attributes: [
            "assignedTo",
            // "Ticket". cualificado: el JOIN con team_members también tiene `status`.
            [sq.literal(`COUNT(*) FILTER (WHERE "Ticket"."status" IN ('open','in_progress','waiting'))`), "abiertos"],
            [sq.literal(`COUNT(*) FILTER (WHERE "Ticket"."resolved_at" IS NOT NULL)`), "resueltos"],
          ],
          include: [{ model: TeamMember, as: "assignee", attributes: ["displayName"], required: false }],
          where: { createdAt: { [Op.gte]: desde } },
          group: ["Ticket.assigned_to", "assignee.id", "assignee.display_name"],
          raw: true,
          nest: true,
        }),
        Ticket.findAll({
          attributes: ["status", [sq.fn("COUNT", sq.col("id")), "n"]],
          group: ["status"],
          raw: true,
        }),
        Ticket.findAll({
          attributes: ["priority", [sq.fn("COUNT", sq.col("id")), "n"]],
          where: { status: ACTIVE_STATUSES },
          group: ["priority"],
          raw: true,
        }),
      ]);

    // Serie mensual continua (meses sin datos a 0, que el gráfico no salte).
    const serie = [];
    const cursor = new Date(desde);
    const creadosMap = new Map(creadosMes.map((r) => [r.mes, Number(r.n)]));
    const resueltosMap = new Map(resueltosMes.map((r) => [r.mes, Number(r.n)]));
    for (let i = 0; i < months; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      serie.push({ mes: key, creados: creadosMap.get(key) || 0, resueltos: resueltosMap.get(key) || 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const t = tiempos[0] || {};
    const sla = slaFilas[0] || {};
    const pct = (okN, total) => (total > 0 ? Math.round((okN / total) * 100) : null);

    const porEstado = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };
    for (const fila of actuales) if (fila.status in porEstado) porEstado[fila.status] = Number(fila.n);

    const prioridadActiva = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const fila of porPrioridad) if (fila.priority in prioridadActiva) prioridadActiva[fila.priority] = Number(fila.n);

    return ok({
      months,
      desde: desde.toISOString(),
      serie,
      tiempos: {
        avgFirstResponseHours: t.avgFirstResponse != null ? Math.round(Number(t.avgFirstResponse) * 10) / 10 : null,
        avgResolutionHours: t.avgResolution != null ? Math.round(Number(t.avgResolution) * 10) / 10 : null,
      },
      sla: {
        firstResponsePct: pct(Number(sla.frOk) || 0, Number(sla.frTotal) || 0),
        resolutionPct: pct(Number(sla.rsOk) || 0, Number(sla.rsTotal) || 0),
        muestras: { firstResponse: Number(sla.frTotal) || 0, resolution: Number(sla.rsTotal) || 0 },
      },
      porCategoria: porCategoria
        .map((r) => ({
          categoryId: r.categoryId || null,
          nombre: r.category?.name || "Sin categoría",
          color: r.category?.color || null,
          n: Number(r.n),
        }))
        .sort((a, b) => b.n - a.n),
      porResponsable: porResponsable
        .map((r) => ({
          teamMemberId: r.assignedTo || null,
          nombre: r.assignee?.displayName || "Sin asignar",
          abiertos: Number(r.abiertos),
          resueltos: Number(r.resueltos),
        }))
        .sort((a, b) => b.abiertos - a.abiertos),
      porEstado,
      prioridadActiva,
    });
  } catch (err) {
    return serverError(err);
  }
});
