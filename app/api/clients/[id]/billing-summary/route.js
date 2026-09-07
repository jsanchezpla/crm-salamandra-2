import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getClientBillingSummary } from "../../../../../lib/billing/billingSummary.js";

/**
 * GET /api/clients/[id]/billing-summary?from=&to=&limite=
 *
 * Resumen de facturación del cliente (sin from/to → histórico completo).
 * `limite` es cuántas facturas se traen; el tope duro lo pone
 * `limiteDeFacturas` (07/09/2026, AV-0066: la ficha enseñaba 10 de 134).
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? null;
    const to = searchParams.get("to") ?? null;
    const limite = searchParams.get("limite");

    const data = await getClientBillingSummary({ tenantModels, clientId: id, from, to, limite });
    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
