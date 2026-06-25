import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/training/quiz-attempts/companies-list
 *
 * Lista DISTINCT de empresas con intentos en el tenant (campo `empresa`
 * libre del payload de TutorLMS — no es FK a `companies`). Sirve para
 * poblar el dropdown "Empresa" en /formacion/cuestionarios.
 *
 * LIMIT 100 para acotar el dropdown — si un tenant tiene >100 empresas
 * distintas en este campo libre conviene normalizar a una FK (backlog).
 *
 * Ordenado por count DESC: las empresas con más intentos arriba.
 *
 * Auth: JWT + hasModule("training" || "cuestionarios").
 */
export const GET = withTenant(async (_request, _ctx, { tenantSequelize, hasModule, slug }) => {
  try {
    if (!hasModule("training") && !hasModule("cuestionarios")) {
      return forbidden("Módulo no activo");
    }
    const schema = `crm_${slug}`;

    const [rows] = await tenantSequelize.query(
      `SELECT empresa AS name, COUNT(*)::int AS cnt
       FROM "${schema}"."quiz_attempts"
       WHERE empresa IS NOT NULL AND empresa != ''
       GROUP BY 1
       ORDER BY cnt DESC, name ASC
       LIMIT 100`
    );

    const items = rows.map((r) => ({ name: r.name, count: r.cnt }));

    return ok({ items });
  } catch (err) {
    return serverError(err);
  }
});
