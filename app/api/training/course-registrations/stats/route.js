import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/course-registrations/stats?courseId=<uuid>
 *
 * Estadísticas agregadas sobre los registros previos de un curso.
 * JWT + hasModule(training).
 *
 * Devuelve:
 *   - totalRegistrations
 *   - distributionByCompany     [{ companyName, count, percentage }]  (top 10)
 *   - motivationDistribution    { "1": n, "2": n, ..., "5": n }
 *   - stressDistribution        { "1": n, "2": n, ..., "5": n }
 *   - averageMotivation         number
 *   - averageStress             number
 *   - registrationsByMonth      [{ month: "YYYY-MM", count }]  (últimos 12 meses)
 *
 * Las queries usan los índices wp_course_id_idx + composite (email, wp_product_id)
 * para mantenerse rápidas.
 */
export const GET = withTenant(async (request, _ctx, { tenantSequelize, tenantModels, hasModule, slug }) => {
  try {
    if (!hasModule("training")) return forbidden("Módulo training no activo");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    if (!courseId) return error("courseId obligatorio");

    const { CourseRegistration } = tenantModels;
    const schema = `crm_${slug}`;

    // ── Filtros opcionales (mismos que /list y /export) ────────────────
    // Si no llegan, stats refleja TODO el curso (compat con consumidores
    // anteriores). Si llegan, stats coincide con lo que el usuario ve.
    const search = (searchParams.get("search") || "").trim();
    const companyId = searchParams.get("companyId");
    const fromIso = searchParams.get("from");
    const toIso = searchParams.get("to");

    // ── WHERE construido para Sequelize.count ──────────────────────────
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

    // ── WHERE crudo para las queries SQL ──────────────────────────────
    // courseId siempre va en $1; el resto de filtros se añade dinámicamente
    // con índices $2, $3, … y se aplican AND al WHERE base. El alias del
    // FROM se pasa a buildRawFilters() (la query distributionByCompany usa
    // alias "cr"; las otras no, así que se pasa null).
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
        distributionByCompany: [],
        motivationDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        stressDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        averageMotivation: 0,
        averageStress: 0,
        registrationsByMonth: [],
      });
    }

    // ── distributionByCompany (top 10) ─────────────────────────────────
    const fCompany = buildRawFilters("cr");
    const [companyRows] = await tenantSequelize.query(
      `
      SELECT COALESCE(c.name, 'Sin empresa asociada') AS company_name,
             COUNT(*)::int AS cnt
      FROM "${schema}"."course_registrations" cr
      LEFT JOIN "${schema}"."companies" c ON c.id = cr.company_id
      WHERE cr.course_id = $1${fCompany.sql}
      GROUP BY 1
      ORDER BY cnt DESC, 1 ASC
      LIMIT 10
      `,
      { bind: [courseId, ...fCompany.binds] }
    );
    const distributionByCompany = companyRows.map((r) => ({
      companyName: r.company_name,
      count: r.cnt,
      percentage: total ? Math.round((r.cnt / total) * 1000) / 10 : 0,
    }));

    // ── motivationCurrent + stressLevel distribución y media ───────────
    // Las columnas viven en diagnosis_data JSONB. Castea a int si es valor 1-5.
    const fDiag = buildRawFilters(null);
    const [diagRows] = await tenantSequelize.query(
      `
      SELECT
        (diagnosis_data->>'motivationCurrent')::int AS motivation,
        (diagnosis_data->>'stressLevel')::int      AS stress
      FROM "${schema}"."course_registrations"
      WHERE course_id = $1${fDiag.sql}
      `,
      { bind: [courseId, ...fDiag.binds] }
    );

    const motivationDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const stressDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let motivationSum = 0, motivationCount = 0;
    let stressSum = 0, stressCount = 0;
    for (const r of diagRows) {
      const m = r.motivation;
      if (Number.isInteger(m) && m >= 1 && m <= 5) {
        motivationDistribution[m]++;
        motivationSum += m;
        motivationCount++;
      }
      const s = r.stress;
      if (Number.isInteger(s) && s >= 1 && s <= 5) {
        stressDistribution[s]++;
        stressSum += s;
        stressCount++;
      }
    }
    const averageMotivation = motivationCount ? Math.round((motivationSum / motivationCount) * 100) / 100 : 0;
    const averageStress = stressCount ? Math.round((stressSum / stressCount) * 100) / 100 : 0;

    // ── registrationsByMonth (últimos 12 meses) ─────────────────────────
    const fMonth = buildRawFilters(null);
    const [monthRows] = await tenantSequelize.query(
      `
      SELECT to_char(date_trunc('month', submitted_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS cnt
      FROM "${schema}"."course_registrations"
      WHERE course_id = $1
        AND submitted_at >= now() - interval '12 months'${fMonth.sql}
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      { bind: [courseId, ...fMonth.binds] }
    );
    const registrationsByMonth = monthRows.map((r) => ({ month: r.month, count: r.cnt }));

    process.stdout.write(
      `[retorika:stats] courseId=${courseId} total=${total} avgMotivation=${averageMotivation} avgStress=${averageStress}\n`
    );

    return ok({
      totalRegistrations: total,
      distributionByCompany,
      motivationDistribution,
      stressDistribution,
      averageMotivation,
      averageStress,
      registrationsByMonth,
    });
  } catch (err) {
    return serverError(err);
  }
});
