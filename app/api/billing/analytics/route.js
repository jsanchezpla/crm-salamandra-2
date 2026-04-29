import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getKpisForPeriod } from "../../../../lib/billing/billingSummary.js";

/**
 * GET /api/billing/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Devuelve KPIs del periodo:
 *   - Facturado (taxBase), Cobrado (paidAmount de las facturas del periodo),
 *     Pendiente (>=0), Ticket medio, Clientes únicos
 *   - Costes por categoría/tipo (taxBase)
 *   - Margen Bruto / Neto / EBITDA sobre base imponible
 *   - Evolución mensual
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const data = await getKpisForPeriod({ tenantModels, from, to });
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
