import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildTicketPdfBuffer, ticketPdfFilename } from "@/lib/billing/ticketPdf.js";
import { membreteDe } from "@/lib/billing/membrete.js";
import { cargarLogo } from "@/lib/billing/logoMembrete.js";
import { billingHasPatients } from "@/lib/billing/patientLink.js";

/**
 * GET /api/billing/payments/[id]/ticket — el justificante de cobro en PDF
 * (04/09/2026, Rodrigo).
 *
 * El papelito que se le da a la familia al pagar en recepción. NO es una
 * factura y el documento lo dice: en Aumenta se cobra durante el mes y se
 * factura al cierre, así que entre el pago y la factura pasan semanas.
 *
 * Vale para cualquier cobro, tenga factura detrás o no — un cobro de cuota sin
 * factura es justo el caso que lo pide—. El PDF se genera al vuelo y no se
 * guarda: no es un documento fiscal, no hay numeración que llevar, y volver a
 * pedirlo da exactamente el mismo papel.
 */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice, Client, Patient, TenantBillingSettings } = tenantModels;
    const { id } = await params;

    const include = [];
    if (Invoice) {
      include.push({
        model: Invoice, as: "invoice", attributes: ["id", "number"], required: false,
        ...(Client ? { include: [{ model: Client, as: "client", attributes: ["id", "name"], required: false }] } : {}),
      });
    }
    if (Client) include.push({ model: Client, as: "client", attributes: ["id", "name"], required: false });
    if (Patient && billingHasPatients(hasModule)) {
      include.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false });
    }

    const payment = await Payment.findByPk(id, { include });
    if (!payment) return notFound("Cobro no encontrado");

    const settings = (await TenantBillingSettings.findOne()) || {};
    const logo = await cargarLogo(membreteDe(settings, "factura").logoUrl);

    // El pagador, por los dos caminos de siempre: el enlace directo del cobro y
    // el de su factura (un cobro suelto no tiene factura, y uno de factura
    // puede no tener `clientId` propio).
    const cliente = payment.client ?? payment.invoice?.client ?? null;
    const patientName = payment.patient
      ? [payment.patient.firstName, payment.patient.lastName].filter(Boolean).join(" ") || null
      : null;

    const buffer = await buildTicketPdfBuffer({
      payment,
      clientName: cliente?.name ?? null,
      patientName,
      invoiceNumber: payment.invoice?.number ?? null,
      settings,
      logo,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `inline`: en recepción se abre y se imprime, no se archiva.
        "Content-Disposition": contentDisposition("inline", ticketPdfFilename(payment)),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
