import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { serializeRankingRow, readAreaScores } from "../../../../lib/clinica/serialize.js";
import { AREA_KEYS } from "../../../../lib/clinica/performanceAreas.js";
import { computeTotalScore, proposeIncentive, tiersFromTenant } from "../../../../lib/clinica/incentives.js";
import { getPerformanceRoles, findRoleByKey, resolveRoleForMember } from "../../../../lib/clinica/performanceConfig.js";
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
 * mensual de un miembro del equipo. Solo dirección.
 *
 * Body: {
 *   therapistId, period: "YYYY-MM",
 *   roleKey?,                                          // rol de desempeño (opcional)
 *   areaScores: { <claveDeArea>: 0..100, … },          // claves del rol resuelto
 *   complements: { occupation:0..100, seniority:>=0, attendance:bool },
 *   notes
 * }
 *
 * Desempeño por roles (2026-07-29): el rol se resuelve con el `roleKey` del
 * body si existe en la config del tenant, o por el puesto del miembro
 * (resolveRoleForMember). Sin config guardada todo se reduce al rol legacy
 * (mismas 7 áreas y pesos de siempre). Las puntuaciones se escriben SIEMPRE en
 * `area_scores` (JSONB, merge por clave) y se espejan a la columna legacy
 * `${key}Score` cuando la clave es area1..area8 (mantiene vivas las queries
 * viejas). Claves de OTRO rol ya guardadas en la fila se conservan en el JSONB
 * pero NO puntúan: el total se calcula solo con las áreas del rol resuelto.
 *
 * La puntuación total se calcula (media ponderada de las áreas puntuadas) y el
 * incentivo propuesto se deriva de los tramos del tenant. La aprobación
 * (approvedIncentive) NO se toca aquí: es un acto aparte de Dirección.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
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

  // Rol de desempeño: el pedido en el body (si existe en la config) o el que
  // corresponda al puesto del miembro. Sin config → rol legacy.
  const rolesConfig = getPerformanceRoles(ctx.tenant);
  let role = null;
  if (body.roleKey !== undefined && body.roleKey !== null && body.roleKey !== "") {
    role = findRoleByKey(rolesConfig, String(body.roleKey));
    if (!role) return error("roleKey no existe en la configuración de desempeño");
  } else {
    role = resolveRoleForMember(rolesConfig, therapist);
  }
  const roleAreaKeys = new Set(role.areas.map((a) => a.key));

  // Áreas: cada clave debe pertenecer al rol resuelto; cada valor, entero
  // 0-100 o null (null borra la puntuación de esa área).
  const scores = {};
  const areaIn = body.areaScores ?? {};
  for (const [key, value] of Object.entries(areaIn)) {
    if (!roleAreaKeys.has(key)) return error(`El área "${key}" no pertenece al rol "${role.name}"`);
    const val = intInRange(value, 0, 100);
    if (val === undefined) return error(`Puntuación de ${key} inválida (0-100)`);
    scores[key] = val;
  }

  const fields = {};
  // Espejo legacy: las claves area1..area8 siguen escribiendo su columna
  // (area5 no existe como columna, y AREA_KEYS ya la excluye).
  for (const key of AREA_KEYS) {
    if (key in scores) fields[`${key}Score`] = scores[key];
  }

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

  // JSONB nuevo: merge por clave sobre lo ya guardado (regla de lectura con
  // fallback legacy). Un null borra la clave; las claves huérfanas de otro rol
  // se conservan tal cual.
  const existingScores = metric ? readAreaScores(metric) : {};
  const newStored = { ...existingScores };
  for (const [key, val] of Object.entries(scores)) {
    if (val === null) delete newStored[key];
    else newStored[key] = val;
  }
  fields.areaScores = newStored;
  fields.roleKey = role.key;

  // Puntuación total: SOLO las áreas del rol resuelto (combinando lo nuevo con
  // lo ya guardado de esas mismas claves).
  const merged = {};
  for (const key of roleAreaKeys) {
    merged[key] = key in scores ? scores[key] : newStored[key] ?? null;
  }
  const totalScore = computeTotalScore(merged, role.areas);
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

  return ok(serializeRankingRow(metric, { therapist, tiers: tiersFromTenant(ctx.tenant), role }));
});
