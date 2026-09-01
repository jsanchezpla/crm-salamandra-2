import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { buildQuotePdfBuffer, quotePdfFilename } from "../../../../../../lib/billing/invoicePdf.js";
import { membreteDe } from "../../../../../../lib/billing/membrete.js";
import { cargarLogo } from "../../../../../../lib/billing/logoMembrete.js";
import { quoteSentTemplate } from "../../../../../../lib/email/templates/billing/quoteSent.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";
import { logBillingAudit, datosPeticion } from "../../../../../../lib/billing/audit.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";

/**
 * POST /api/billing/quotes/[id]/send
 *
 * Envía el presupuesto al cliente por correo con el PDF adjunto y lo marca
 * como enviado. Hermano del send de facturas y con sus mismas reglas:
 *
 * - Best-effort: si el correo falla, el presupuesto queda marcado igual y la
 *   respuesta lo dice en `emailEnviado`/`emailError`.
 * - `?via=whatsapp|other` solo anota el canal, para quien lo entrega a mano.
 * - NO se envía desde la DEMO (pública, con sesión de admin para cualquiera).
 * - Se puede reenviar: un presupuesto ya `sent`/`viewed` no cambia de estado
 *   (visto no retrocede a enviado), pero el correo sale igual y se anota.
 * - Un presupuesto convertido o rechazado ya no se envía (422).
 */
const VALID_VIA = new Set(["email", "whatsapp", "other"]);
const ENVIABLES = new Set(["draft", "sent", "viewed", "accepted", "expired"]);

export const POST = withTenant(async (request, { params }, ctx) => {
  const { tenantModels, hasModule, tenant } = ctx;
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { id } = await params;
    const { Quote, Client, TenantBillingSettings } = tenantModels;
    const { searchParams } = new URL(request.url);
    const viaParam = searchParams.get("via");
    const via = viaParam && VALID_VIA.has(viaParam) ? viaParam : null;

    const quote = await Quote.findByPk(id);
    if (!quote) return notFound("Presupuesto no encontrado");
    if (!ENVIABLES.has(quote.status)) {
      return error(`Un presupuesto en estado '${quote.status}' ya no se envía`, 422);
    }

    const cliente = quote.clientId && Client ? await Client.findByPk(quote.clientId) : null;
    const destino = (cliente?.email || "").trim();
    const quiereEmail = via === null || via === "email";

    let emailEnviado = false;
    let emailError = null;

    if (quiereEmail && destino && isDemoTenant(ctx)) {
      emailError = "El envío de presupuestos por correo está desactivado en la demo";
    } else if (quiereEmail && destino) {
      try {
        const settings = (await TenantBillingSettings.findOne()) || {};
        const logo = await cargarLogo(membreteDe(settings, "presupuesto").logoUrl);
        const pdf = await buildQuotePdfBuffer({ quote, client: cliente, settings, logo });

        const total = `${Number(quote.total ?? 0).toLocaleString("es-ES", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} EUR`;

        const tpl = quoteSentTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: cliente?.name,
          quoteNumber: quote.number || quote.id,
          issueDate: quote.issueDate,
          validUntil: quote.validUntil ?? null,
          total,
        });

        const resend = getTenantResendConfig({ tenant });
        const envio = await sendEmail({
          to: destino,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          from: resend.fromEmail || undefined,
          replyTo: resend.replyTo || undefined,
          apiKey: resend.apiKey || undefined,
          attachments: [{ filename: quotePdfFilename(quote), content: pdf }],
        });
        // sendEmail no lanza: {ok:false} si Resend rechaza, {dryRun:true} sin
        // correo configurado. Mirar la respuesta antes de dar nada por enviado.
        if (!envio.ok) {
          emailError = envio.error || "Resend rechazó el envío";
        } else if (envio.dryRun) {
          emailError = "Correo no configurado: el presupuesto no ha salido (modo simulacro)";
        } else {
          emailEnviado = true;
        }
        if (emailError) process.stderr.write(`[billing:quote-send] ${quote.id}: ${emailError}\n`);
      } catch (mailErr) {
        emailError = mailErr.message;
        process.stderr.write(`[billing:quote-send] email fail: ${mailErr.message}\n`);
      }
    } else if (quiereEmail && !destino) {
      emailError = "El cliente no tiene email en su ficha";
    }

    // El estado solo avanza desde borrador; «visto» o «aceptado» no retroceden.
    const updates = {
      customFields: {
        ...(quote.customFields || {}),
        sentVia: via || (emailEnviado ? "email" : "other"),
        ...(emailEnviado ? { sentTo: destino } : {}),
      },
    };
    if (quote.status === "draft") updates.status = "sent";
    if (!quote.sentAt) updates.sentAt = new Date();
    const estadoAntes = quote.status;
    await quote.update(updates);

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "quote.sent",
      entity: "Quote",
      entityId: quote.id,
      before: { estado: estadoAntes },
      after: { estado: quote.status, via: via || (emailEnviado ? "email" : "other"), emailEnviado },
    });

    return ok({ ...quote.toJSON(), emailEnviado, emailError });
  } catch (err) {
    return serverError(err);
  }
});
