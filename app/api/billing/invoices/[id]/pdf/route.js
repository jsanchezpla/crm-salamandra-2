import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/lib/billing/invoicePdf.js";
import { membreteDe } from "@/lib/billing/membrete.js";
import { cargarLogo } from "@/lib/billing/logoMembrete.js";

/**
 * GET /api/billing/invoices/[id]/pdf
 * Descarga el PDF de una factura emitida (attachment). Los borradores no tienen PDF.
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Client, TenantBillingSettings } = tenantModels;
    const { id } = await params;

    const invoice = await Invoice.findByPk(id, {
      include: [{ model: Client, as: "client" }],
    });
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status === "draft") {
      return error("Un borrador no tiene PDF: emítela primero", 409);
    }

    const settings = (await TenantBillingSettings.findOne()) || {};
    const partners = Array.isArray(settings.partners) ? settings.partners : [];
    const partnerName = invoice.partnerId
      ? partners.find((p) => p.id === invoice.partnerId)?.name || null
      : null;

    const logo = await cargarLogo(membreteDe(settings, "factura").logoUrl);
    const buffer = await buildInvoicePdfBuffer({
      invoice,
      client: invoice.client,
      settings,
      partnerName,
      logo,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition("attachment", invoicePdfFilename(invoice)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
