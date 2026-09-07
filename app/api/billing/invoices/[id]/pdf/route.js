import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildInvoicePdfBuffer, buildInvoicePreviewPdfBuffer, invoicePdfFilename } from "@/lib/billing/invoicePdf.js";
import { membreteDe } from "@/lib/billing/membrete.js";
import { cargarLogo } from "@/lib/billing/logoMembrete.js";
import { invoicePatientInclude } from "@/lib/billing/patientLink.js";

/**
 * GET /api/billing/invoices/[id]/pdf
 * Descarga el PDF de una factura emitida (attachment). Los borradores no tienen PDF.
 *
 * ?previa=1 lo abre EN PANTALLA (inline) en vez de descargarlo, y es la única
 * puerta del borrador: se ve tal y como quedará, con «VISTA PREVIA» cruzando
 * las páginas mientras siga sin emitir (07/09/2026, Rodrigo: «quiero que haya
 * una vista previa de las facturas antes de emitirlas con un botón»). El
 * documento no se guarda ni se numera: emitir sigue siendo un acto aparte.
 *
 * ?paciente=0 quita el nombre del paciente (sale por defecto si la factura lo
 * tiene) y ?sello=0 quita el sello del centro (sale por defecto si está
 * configurado). 31/08/2026: una factura a una fundación tiene que poder decir
 * por qué niño es — y también poder callárselo.
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Client, TenantBillingSettings } = tenantModels;
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    const invoice = await Invoice.findByPk(id, {
      include: [
        { model: Client, as: "client" },
        ...invoicePatientInclude(tenantModels, hasModule),
      ],
    });
    if (!invoice) return notFound("Factura no encontrada");
    // La vista previa es la ÚNICA forma de sacar el PDF de un borrador, y sale
    // marcada: se abre en pantalla para decidir si se emite, no se descarga
    // para mandársela a nadie.
    const previa = searchParams.get("previa") === "1";
    if (invoice.status === "draft" && !previa) {
      return error("Un borrador no tiene PDF: emítela primero", 409);
    }

    const settings = (await TenantBillingSettings.findOne()) || {};
    const partners = Array.isArray(settings.partners) ? settings.partners : [];
    const partnerName = invoice.partnerId
      ? partners.find((p) => p.id === invoice.partnerId)?.name || null
      : null;

    const logo = await cargarLogo(membreteDe(settings, "factura").logoUrl);
    const patientName =
      searchParams.get("paciente") !== "0" && invoice.patient
        ? `${invoice.patient.firstName || ""} ${invoice.patient.lastName || ""}`.trim() || null
        : null;
    const stamp = searchParams.get("sello") !== "0" ? await cargarLogo(settings.stampUrl) : null;
    // Solo el borrador lleva marca: una factura ya emitida, aunque se abra en
    // pantalla, ES el documento y no puede salir sellada.
    const construir = invoice.status === "draft" ? buildInvoicePreviewPdfBuffer : buildInvoicePdfBuffer;
    const buffer = await construir({
      invoice,
      client: invoice.client,
      settings,
      partnerName,
      logo,
      patientName,
      stamp,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": previa
          ? contentDisposition("inline", invoicePdfFilename(invoice, { previa: true }))
          : contentDisposition("attachment", invoicePdfFilename(invoice)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        // Se abre dentro de un <iframe> nuestro (mismo origen), como la vista
        // previa del archivo de Documentos: el documento no carga nada.
        ...(previa ? { "Content-Security-Policy": "default-src 'none'; object-src 'self'" } : {}),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
