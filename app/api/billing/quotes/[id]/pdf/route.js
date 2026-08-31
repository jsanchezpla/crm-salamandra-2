import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildQuotePdfBuffer, quotePdfFilename } from "@/lib/billing/invoicePdf.js";
import { membreteDe } from "@/lib/billing/membrete.js";
import { cargarLogo } from "@/lib/billing/logoMembrete.js";

/**
 * GET /api/billing/quotes/[id]/pdf
 *
 * Descarga el PDF de un presupuesto (attachment). A diferencia de la factura,
 * el borrador SÍ tiene PDF: un presupuesto no es un documento fiscal, va
 * numerado desde que nace y enseñárselo al cliente antes de «enviarlo»
 * formalmente es su uso normal.
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Quote, Client, TenantBillingSettings } = tenantModels;
    const { id } = await params;

    const quote = await Quote.findByPk(id, {
      include: [{ model: Client, as: "client" }],
    });
    if (!quote) return notFound("Presupuesto no encontrado");

    const settings = (await TenantBillingSettings.findOne()) || {};
    const logo = await cargarLogo(membreteDe(settings, "presupuesto").logoUrl);
    const buffer = await buildQuotePdfBuffer({ quote, client: quote.client, settings, logo });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition("attachment", quotePdfFilename(quote)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
