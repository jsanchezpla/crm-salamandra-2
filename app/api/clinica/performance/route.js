import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { serializeRankingRow } from "../../../../lib/clinica/serialize.js";
import { AREA_KEYS } from "../../../../lib/clinica/performanceAreas.js";
import { computeTotalScore, proposeIncentive, tiersFromTenant } from "../../../../lib/clinica/incentives.js";
import { logClinicaAudit } from "../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Entero en rango, o null si viene vacío. Devuelve `undefined` si es inválido.
function intInRange(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

function parsePeriod(body) {
  let year;
  let month;
  if (typeof body.period === "string" && body.period.includes("-")) {
    [year, month] = body.period.split("-").map(Number);
  } else {
    year = Number(body.periodYear);
    month = Number(body.periodMonth);
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * POST /api/clinica/performance — crear o actualizar (upsert) la evaluación
 * mensual de un terapeuta. Solo dirección.
 *
 * Body: {
 *   therapistId, period: "YYYY-MM",
 *   areaScores: { area1:0..100, area2:…, area8:… },   // cada una opcional
 *   complements: { occupation:0..100, seniority:>=0, attendance:bool },
 *   notes
 * }
 *
 * La puntuación total se calcula (media ponderada de las áreas puntuadas) y el
 * incentivo propuesto se deriva de los tramos del tenant. La aprobación
 * (approvedIncentive) NO se toca aquí: es un acto aparte de Dirección.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede registrar evaluaciones");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const therapistId = body.therapistId;
  if (!UUID_RE.test(therapistId ?? "")) return error("therapistId inválido");
  const period = parsePeriod(body);
  if (!period) return error("Periodo inválido (usa YYYY-MM)");

  const { PerformanceMetric, TeamMember } = ctx.tenantModels;
  const therapist = await TeamMember.findByPk(therapistId);
  if (!therapist) return notFound("Terapeuta no encontrado");

  // Áreas: cada una entero 0-100 o null. Guardamos también un mapa por clave
  // para calcular la puntuación total.
  const fields = {};
  const scores = {};
  const areaIn = body.areaScores ?? {};
  for (const key of AREA_KEYS) {
    if (!(key in areaIn)) continue;
    const val = intInRange(areaIn[key], 0, 100);
    if (val === undefined) return error(`Puntuación de ${key} inválida (0-100)`);
    fields[`${key}Score`] = val;
    scores[key] = val;
  }
  // Para el total necesitamos TODAS las áreas (las no enviadas, desde la fila
  // existente si la hay); se resuelve más abajo tras localizar la fila.

  // Complementos.
  const comp = body.complements ?? {};
  if ("occupation" in comp) {
    const v = intInRange(comp.occupation, 0, 100);
    if (v === undefined) return error("Ocupación inválida (0-100)");
    fields.complementOccupation = v;
  }
  if ("seniority" in comp) {
    const v = intInRange(comp.seniority, 0, 100);
    if (v === undefined) return error("Antigüedad inválida");
    fields.complementSeniority = v;
  }
  if ("attendance" in comp) {
    fields.complementAttendance = comp.attendance === null ? null : Boolean(comp.attendance);
  }

  if (body.notes !== undefined) {
    fields.notes = body.notes === null ? null : String(body.notes).slice(0, 5000);
  }

  const where = { therapistId, periodYear: period.year, periodMonth: period.month };
  let metric = await PerformanceMetric.findOne({ where });
  const before = metric ? metric.toJSON() : null;

  // Puntuación total: combina las áreas nuevas con las ya guardadas.
  const merged = {};
  for (const key of AREA_KEYS) {
    merged[key] = key in scores ? scores[key] : metric ? metric[`${key}Score`] ?? null : null;
  }
  const totalScore = computeTotalScore(merged);
  fields.totalScore = totalScore;
  fields.proposedIncentive = proposeIncentive(totalScore, tiersFromTenant(ctx.tenant));

  if (metric) {
    await metric.update(fields);
  } else {
    metric = await PerformanceMetric.create({ ...where, ...fields });
  }

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: before ? "clinica.performance.update" : "clinica.performance.create",
    entity: "PerformanceMetric",
    entityId: metric.id,
    before,
    after: metric.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok(serializeRankingRow(metric, { therapist, tiers: tiersFromTenant(ctx.tenant) }));
});
