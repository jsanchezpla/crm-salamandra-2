import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { aggregateTeamProductivity } from "../../../../lib/clinica/productivityQuery.js";
import { serializeIncidencia, INCIDENCIA_CATEGORIES } from "../../../../lib/clinica/incidencias.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/clinica/dashboard — datos operativos del mes para el panel de
 * Dirección: totales de productividad + resumen de incidencias. SOLO DIRECCIÓN.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver el dashboard");
  const { Booking, TeamMember, Incidencia, Patient } = ctx.tenantModels;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStart = new Date(year, month - 1, 1);

  // Productividad del mes en curso (totales).
  const { totals: productividad } = await aggregateTeamProductivity({ Booking, TeamMember, year, month });

  // Incidencias.
  const openRows = await Incidencia.findAll({
    where: { status: { [Op.ne]: "resolved" } },
    attributes: ["status", "priority", "category"],
    raw: true,
  });
  let pending = 0;
  let inProgress = 0;
  let urgent = 0;
  const byCatMap = {};
  for (const r of openRows) {
    if (r.status === "pending") pending += 1;
    else if (r.status === "in_progress") inProgress += 1;
    if (r.priority === "high") urgent += 1;
    byCatMap[r.category] = (byCatMap[r.category] ?? 0) + 1;
  }
  const open = pending + inProgress;
  const byCategory = INCIDENCIA_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: byCatMap[c.key] ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const resolvedMonth = await Incidencia.count({ where: { status: "resolved", resolvedAt: { [Op.gte]: monthStart } } });

  const recentRows = await Incidencia.findAll({
    where: { status: { [Op.ne]: "resolved" } },
    include: [
      { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
      { model: TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
    ],
    order: [["incidenceDate", "DESC"], ["createdAt", "DESC"]],
    limit: 5,
  });
  const recentOpen = recentRows.map(serializeIncidencia);

  return ok({
    period: { year, month, value: `${year}-${String(month).padStart(2, "0")}` },
    productividad,
    incidencias: { open, pending, inProgress, urgent, resolvedMonth, byCategory, recentOpen },
  });
});
