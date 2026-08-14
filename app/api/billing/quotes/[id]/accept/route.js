import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";


// POST /api/billing/quotes/[id]/accept — marcar presupuesto como aceptado
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Quote } = tenantModels;
    const { id } = await params;
    const quote = await Quote.findByPk(id);
    if (!quote) return notFound("Presupuesto no encontrado");

    if (quote.status === "converted") {
      return error("El presupuesto ya está convertido en factura", 409);
    }
    if (quote.status === "accepted") return ok(quote);

    await quote.update({ status: "accepted", acceptedAt: new Date() });
    return ok(quote);
  } catch (err) {
    return serverError(err);
  }
});
