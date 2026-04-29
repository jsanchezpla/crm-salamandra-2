import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getClientBillingSummary } from "../../../../../lib/billing/billingSummary.js";

/**
 * GET /api/clients/[id]/billing-summary?from=&to=
 *
 * Resumen de facturación del cliente (sin from/to → histórico completo).
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? null;
    const to = searchParams.get("to") ?? null;

    const data = await getClientBillingSummary({ tenantModels, clientId: id, from, to });
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
