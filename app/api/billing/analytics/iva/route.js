import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { buildIvaReport } from "../../../../../lib/billing/buildIvaReport.js";

/**
 * GET /api/billing/analytics/iva?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Devuelve Libro de IVA + estimación Modelo 303.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const data = await buildIvaReport({ tenantModels, from, to });
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
