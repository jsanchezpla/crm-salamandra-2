import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { serializeRankingRow, monthShort } from "../../../../../lib/clinica/serialize.js";
import { tiersFromTenant } from "../../../../../lib/clinica/incentives.js";
import { parsePeriodString } from "../../../../../lib/clinica/period.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Panel de Dirección: ranking del periodo, KPIs, alertas computadas, evolución del
// equipo y total de incentivos propuestos. SOLO DIRECCIÓN. Soporta ?period=YYYY-MM
// (por defecto, el último periodo con datos).
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver el panel del equipo");
  const { PerformanceMetric, TeamMember, ClinicalReport } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const tiers = tiersFromTenant(ctx.tenant);

  // Lista de terapeutas activos (para el editor de evaluación: permite evaluar
  // también a quien aún no tiene métrica en el periodo).
  const therapists = (
    await TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"], order: [["displayName", "ASC"]] })
  ).map((t) => ({ id: t.id, name: t.displayName }));

  let year;
  let month;
  const period = sp.get("period");
  if (period) {
    const parsed = parsePeriodString(period);
    if (!parsed) return error("Periodo inválido (usa YYYY-MM)");
    ({ year, month } = parsed);
  } else {
    const latest = await PerformanceMetric.findOne({ order: [["periodYear", "DESC"], ["periodMonth", "DESC"]], attributes: ["periodYear", "periodMonth"], raw: true });
    if (!latest) return ok({ period: null, ranking: [], kpis: {}, alerts: [], history: [], totalProposed: 0, totalApproved: 0, periods: [], therapists, tiers });
    year = latest.periodYear;
    month = latest.periodMonth;
  }

  const metrics = await PerformanceMetric.findAll({
    where: { periodYear: year, periodMonth: month },
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
  });
  // Orden: puntuación DESC con los SIN evaluar al final (en PG, DESC pone los
  // NULL primero — sin esto, una fila auto-creada por un incentivo escrito
  // saldría la nº 1 del ranking).
  metrics.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1));

  // Incentivos ESCRITOS del periodo (Σ por terapeuta): suman al total propuesto.
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

  const ranking = metrics.map((m) =>
    serializeRankingRow(m, { therapist: m.therapist, tiers, extras: extrasByTherapist[m.therapistId] ?? 0 })
  );
  const totalProposed = Math.round(ranking.reduce((s, r) => s + (r.totalProposed ?? 0), 0) * 100) / 100;
  const totalApproved = ranking.reduce((s, r) => s + (r.approvedIncentive ?? 0), 0);

  // KPIs. La media SOLO con filas puntuadas: una métrica sin puntuación (p. ej.
  // auto-creada por un incentivo escrito) no debe hundir la media contando 0.
  const teamActive = ranking.length;
  const scored = ranking.filter((r) => r.totalScore != null);
  const media = scored.length ? Math.round(scored.reduce((s, r) => s + r.totalScore, 0) / scored.length) : 0;

  const delivered = await ClinicalReport.findAll({
    where: { status: "delivered", deliveredAt: { [Op.ne]: null }, dueDate: { [Op.ne]: null } },
    attributes: ["deliveredAt", "dueDate"],
    raw: true,
  });
  let onTimePct = null;
  if (delivered.length) {
    const onTime = delivered.filter((r) => new Date(r.deliveredAt) <= new Date(`${r.dueDate}T23:59:59`)).length;
    onTimePct = Math.round((onTime / delivered.length) * 100);
  }

  // ── Alertas computadas ──
  const alerts = [];
  let aid = 1;
  const overdue = await ClinicalReport.findAll({
    where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: new Date() } },
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
  });
  const overdueByT = {};
  for (const r of overdue) {
    const t = (overdueByT[r.therapistId] ??= { count: 0, name: r.therapist?.displayName });
    t.count += 1;
  }
  for (const [tid, info] of Object.entries(overdueByT)) {
    alerts.push({ id: `a-${aid++}`, severity: info.count >= 2 ? "high" : "medium", therapistId: tid, therapistName: info.name, text: `${info.count} informe${info.count > 1 ? "s" : ""} con entrega vencida.` });
  }
  // Puntuación baja + descenso vs mes anterior
  const prev = new Date(year, month - 2, 1);
  const prevRows = await PerformanceMetric.findAll({ where: { periodYear: prev.getFullYear(), periodMonth: prev.getMonth() + 1 }, attributes: ["therapistId", "totalScore"], raw: true });
  const prevMap = Object.fromEntries(prevRows.map((p) => [p.therapistId, p.totalScore]));
  for (const m of metrics) {
    if (m.totalScore != null && m.totalScore < 72) {
      alerts.push({ id: `a-${aid++}`, severity: "medium", therapistId: m.therapistId, therapistName: m.therapist?.displayName, text: `Puntuación por debajo del estándar del equipo (${m.totalScore}/100).` });
    }
    const pv = prevMap[m.therapistId];
    if (pv != null && m.totalScore != null && m.totalScore <= pv - 8) {
      alerts.push({ id: `a-${aid++}`, severity: "medium", therapistId: m.therapistId, therapistName: m.therapist?.displayName, text: `Descenso de ${pv - m.totalScore} puntos respecto al mes anterior.` });
    }
  }

  // Evolución del equipo: media mensual, últimos 6 meses
  const histRaw = await PerformanceMetric.findAll({
    attributes: ["periodYear", "periodMonth", [fn("AVG", col("total_score")), "avg"]],
    group: ["period_year", "period_month"],
    order: [["periodYear", "ASC"], ["periodMonth", "ASC"]],
    raw: true,
  });
  // Meses sin ninguna puntuación (AVG null) se omiten del gráfico: pintarlos
  // como 0 hundiría la línea y falsearía la tendencia.
  const history = histRaw
    .filter((h) => h.avg != null)
    .slice(-6)
    .map((h) => ({ month: monthShort(h.periodMonth), value: Math.round(Number(h.avg)) }));
  const trend = history.length >= 2 ? history[history.length - 1].value - history[0].value : 0;

  const periods = histRaw.map((h) => ({ value: `${h.periodYear}-${String(h.periodMonth).padStart(2, "0")}`, month: h.periodMonth, year: h.periodYear })).reverse();

  return ok({
    period: { month, year, value: `${year}-${String(month).padStart(2, "0")}` },
    periods,
    ranking,
    kpis: { teamActive, media, onTimePct, complaints: 0 },
    alerts,
    history,
    trend,
    totalProposed,
    totalApproved,
    therapists,
    tiers,
  });
});
