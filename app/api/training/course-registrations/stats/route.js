import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/course-registrations/stats?courseId=<uuid>
 *
 * Estadísticas agregadas del diagnóstico inicial para un curso, en el
 * formato Retorika: 6 escalas Likert (1-5) + 2 escalas categóricas. Reemplaza
 * el antiguo dashboard de cards + top empresas + mensual.
 *
 * JWT + hasModule(training). Mismos filtros y WHERE que /list y /export
 * (courseId, search, companyId, from, to) — coherencia 3-vías.
 *
 * Devuelve:
 *   {
 *     totalRegistrations: number,
 *     scales: {
 *       motivationCurrent:  { type: "likert", distribution: {1:n,...,5:n}, average, total },
 *       motivationVsStart:  { type: "likert", distribution, average, total,
 *                              breakdown3cat: { less, equal, more, lessPct, equalPct, morePct } },
 *       centerEnvironment:  { type: "likert", ... },
 *       stressLevel:        { type: "likert", ... },
 *       hasResources:       { type: "likert", ... },
 *       socialRecognition:  { type: "likert", ... },
 *       workloadFrequency:  { type: "categorical", distribution: { "<slug>": n }, total },
 *       weeklyExtraHours:   { type: "categorical", distribution, total },
 *     }
 *   }
 *
 * Reglas de agregación:
 *   - Likert: solo se cuentan valores enteros 1-5 (null/empty/non-int descartados).
 *     `total` es el count de respuestas válidas en esa escala (≠ totalRegistrations).
 *     `average` redondeado a 2 decimales.
 *   - breakdown3cat (solo motivationVsStart):
 *       less  = dist[1] + dist[2]    → "menos motivados que antes"
 *       equal = dist[3]              → "igual"
 *       more  = dist[4] + dist[5]    → "más motivados"
 *     Porcentajes calculados sobre `total` de motivationVsStart, redondeados a 2 dec.
 *   - Categorical: agrupa por slug crudo, ignora null/empty. `total` = suma.
 *     No se calcula media (los slugs no son valores numéricos).
 */

const LIKERT_SCALES = [
  "motivationCurrent",
  "motivationVsStart",
  "centerEnvironment",
  "stressLevel",
  "hasResources",
  "socialRecognition",
];

const CATEGORICAL_SCALES = ["workloadFrequency", "weeklyExtraHours"];

// camelCase del JSONB → snake_case del SELECT.
const COLUMN_MAP = {
  motivationCurrent: "motivation_current",
  motivationVsStart: "motivation_vs_start",
  centerEnvironment: "center_environment",
  stressLevel: "stress_level",
  hasResources: "has_resources",
  socialRecognition: "social_recognition",
  workloadFrequency: "workload_frequency",
  weeklyExtraHours: "weekly_extra_hours",
};

function emptyLikert() {
  return {
    type: "likert",
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    average: 0,
    total: 0,
  };
}

function emptyCategorical() {
  return {
    type: "categorical",
    distribution: {},
    total: 0,
  };
}

function emptyScales() {
  const scales = {};
  for (const k of LIKERT_SCALES) scales[k] = emptyLikert();
  scales.motivationVsStart.breakdown3cat = {
    less: 0, equal: 0, more: 0,
    lessPct: 0, equalPct: 0, morePct: 0,
  };
  for (const k of CATEGORICAL_SCALES) scales[k] = emptyCategorical();
  return scales;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export const GET = withTenant(async (request, _ctx, { tenantSequelize, tenantModels, hasModule, slug }) => {
  try {
    if (!hasModule("training")) return forbidden("Módulo training no activo");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    if (!courseId) return error("courseId obligatorio");

    const { CourseRegistration } = tenantModels;
    const schema = `crm_${slug}`;

    // ── Filtros opcionales (mismos que /list y /export) ────────────────
    const search = (searchParams.get("search") || "").trim();
    const companyId = searchParams.get("companyId");
    const fromIso = searchParams.get("from");
    const toIso = searchParams.get("to");

    // ── WHERE para Sequelize.count ─────────────────────────────────────
    const where = { courseId };
    if (companyId) where.companyId = companyId;
    if (fromIso || toIso) {
      where.submittedAt = {};
      if (fromIso) where.submittedAt[Op.gte] = new Date(fromIso);
      if (toIso) where.submittedAt[Op.lte] = new Date(toIso);
    }
    if (search) {
      where[Op.or] = [
        { email: { [Op.iLike]: `%${search}%` } },
        { centerName: { [Op.iLike]: `%${search}%` } },
        { centerNif: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // ── WHERE crudo para la query SQL ──────────────────────────────────
    // courseId siempre va en $1; el resto se añade dinámicamente con $2, $3…
    function buildRawFilters(alias) {
      const prefix = alias ? `${alias}.` : "";
      const clauses = [];
      const binds = [];
      let idx = 2;
      if (companyId) {
        clauses.push(`${prefix}company_id = $${idx}`); binds.push(companyId); idx++;
      }
      if (fromIso) {
        clauses.push(`${prefix}submitted_at >= $${idx}`); binds.push(new Date(fromIso)); idx++;
      }
      if (toIso) {
        clauses.push(`${prefix}submitted_at <= $${idx}`); binds.push(new Date(toIso)); idx++;
      }
      if (search) {
        const pattern = `%${search}%`;
        clauses.push(
          `(${prefix}email ILIKE $${idx} OR ${prefix}center_name ILIKE $${idx} OR ${prefix}center_nif ILIKE $${idx})`
        );
        binds.push(pattern); idx++;
      }
      return { sql: clauses.length ? " AND " + clauses.join(" AND ") : "", binds };
    }

    // ── totalRegistrations ─────────────────────────────────────────────
    const total = await CourseRegistration.count({ where });

    if (total === 0) {
      process.stdout.write(`[retorika:stats] courseId=${courseId} total=0\n`);
      return ok({
        totalRegistrations: 0,
        scales: emptyScales(),
      });
    }

    // ── Pull all 8 diagnostic fields en una sola query ─────────────────
    // Extraemos como TEXT (->>) y parseamos en JS para evitar que un valor
    // no numérico tumbe el cast SQL (::int lanza error si la cadena no es
    // numérica). El form actual envía siempre enteros para los Likert,
    // pero esto añade defensa en profundidad sin coste apreciable.
    const fDiag = buildRawFilters("cr");
    const [rows] = await tenantSequelize.query(
      `
      SELECT
        cr.diagnosis_data->>'motivationCurrent'  AS motivation_current,
        cr.diagnosis_data->>'motivationVsStart'  AS motivation_vs_start,
        cr.diagnosis_data->>'centerEnvironment'  AS center_environment,
        cr.diagnosis_data->>'stressLevel'        AS stress_level,
        cr.diagnosis_data->>'hasResources'       AS has_resources,
        cr.diagnosis_data->>'socialRecognition'  AS social_recognition,
        cr.diagnosis_data->>'workloadFrequency'  AS workload_frequency,
        cr.diagnosis_data->>'weeklyExtraHours'   AS weekly_extra_hours
      FROM "${schema}"."course_registrations" cr
      WHERE cr.course_id = $1${fDiag.sql}
      `,
      { bind: [courseId, ...fDiag.binds] }
    );

    const scales = emptyScales();
    const sums = {};
    const counts = {};
    for (const k of LIKERT_SCALES) { sums[k] = 0; counts[k] = 0; }

    for (const r of rows) {
      for (const key of LIKERT_SCALES) {
        const raw = r[COLUMN_MAP[key]];
        if (raw == null || raw === "") continue;
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n >= 1 && n <= 5) {
          scales[key].distribution[n]++;
          sums[key] += n;
          counts[key]++;
        }
      }
      for (const key of CATEGORICAL_SCALES) {
        const v = r[COLUMN_MAP[key]];
        if (v == null || v === "") continue;
        scales[key].distribution[v] = (scales[key].distribution[v] || 0) + 1;
      }
    }

    for (const key of LIKERT_SCALES) {
      scales[key].total = counts[key];
      scales[key].average = counts[key] ? round2(sums[key] / counts[key]) : 0;
    }

    // breakdown3cat para motivationVsStart
    const mvs = scales.motivationVsStart;
    const less = mvs.distribution[1] + mvs.distribution[2];
    const equal = mvs.distribution[3];
    const more = mvs.distribution[4] + mvs.distribution[5];
    const mvsTotal = mvs.total;
    mvs.breakdown3cat = {
      less, equal, more,
      lessPct: mvsTotal ? round2((less / mvsTotal) * 100) : 0,
      equalPct: mvsTotal ? round2((equal / mvsTotal) * 100) : 0,
      morePct: mvsTotal ? round2((more / mvsTotal) * 100) : 0,
    };

    for (const key of CATEGORICAL_SCALES) {
      let t = 0;
      for (const v of Object.values(scales[key].distribution)) t += v;
      scales[key].total = t;
    }

    process.stdout.write(
      `[retorika:stats] courseId=${courseId} total=${total} avgMotivation=${scales.motivationCurrent.average} avgStress=${scales.stressLevel.average}\n`
    );

    return ok({
      totalRegistrations: total,
      scales,
    });
  } catch (err) {
    return serverError(err);
  }
});
