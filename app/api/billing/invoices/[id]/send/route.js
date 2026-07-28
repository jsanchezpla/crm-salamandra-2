import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { withEffectiveStatus } from "../../../../../../lib/billing/invoiceStatus.js";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "../../../../../../lib/billing/invoicePdf.js";
import { invoiceSentTemplate } from "../../../../../../lib/email/templates/billing/invoiceSent.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_VIA = new Set(["email", "whatsapp", "other"]);

/**
 * POST /api/billing/invoices/[id]/send
 *
 * Marca una factura emitida como "enviada al cliente". Solo informativa
 * para tracking comercial — no afecta a cálculos de KPI.
 *
 * Con ?via=email (o por defecto, si el cliente tiene correo) ENVÍA DE VERDAD la
 * factura al cliente con el PDF adjunto — antes solo la marcaba como enviada y
 * había que descargar el PDF y mandarlo a mano. Con ?via=whatsapp|other se
 * limita a anotar el canal, para quien la entrega por su cuenta.
 *
 * El envío es best-effort: si el correo falla, la factura QUEDA marcada como
 * enviada igualmente (la respuesta lo dice en `emailEnviado`/`emailError`) —
 * el estado contable no puede depender de que Resend conteste. `emailEnviado`
 * solo es `true` si Resend confirmó el envío: `sendEmail` NUNCA lanza (devuelve
 * `{ok:false}` o `{dryRun:true}`), así que hay que mirar lo que devuelve.
 *
 * NO se envía desde la DEMO: es pública y da sesión de admin a visitantes
 * anónimos, así que sin este candado cualquiera podría mandar un PDF con pinta
 * de factura oficial desde nuestro dominio al destinatario que quisiera.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  const { tenantModels, hasModule, tenant } = ctx;
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);
    const viaParam = searchParams.get("via");
    const via = viaParam && VALID_VIA.has(viaParam) ? viaParam : null;

    const invoice = await Invoice.findByPk(id);
    if (!invoice) return notFound("Factura no encontrada");
    if (invoice.status !== "issued") {
      return error(`Solo se pueden marcar como enviadas las facturas en estado 'issued'. Estado actual: '${invoice.status}'.`, 422);
    }

    // ── Envío real por email (con el PDF adjunto) ──────────────────────────
    // Se manda salvo que se pida explícitamente otro canal. Si no hay correo
    // del cliente, se degrada a simple anotación en vez de fallar.
    const { Client, TenantBillingSettings } = tenantModels;
    const cliente = invoice.clientId && Client ? await Client.findByPk(invoice.clientId) : null;
    const destino = (cliente?.email || "").trim();
    const quiereEmail = via === null || via === "email";

    let emailEnviado = false;
    let emailError = null;

    if (quiereEmail && destino && isDemoTenant(ctx)) {
      emailError = "El envío de facturas por correo está desactivado en la demo";
    } else if (quiereEmail && destino) {
      try {
        const settings = (await TenantBillingSettings.findOne()) || {};
        const partners = Array.isArray(settings.partners) ? settings.partners : [];
        const partnerName = invoice.partnerId
          ? partners.find((p) => p.id === invoice.partnerId)?.name || null
          : null;
        const pdf = await buildInvoicePdfBuffer({ invoice, client: cliente, settings, partnerName });

        const total = `${Number(invoice.total ?? 0).toLocaleString("es-ES", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ${invoice.currency || "EUR"}`;

        const tpl = invoiceSentTemplate({
          tenantName: tenant.name,
          brand: tenant.settings?.brand,
          clientName: cliente?.name,
          invoiceNumber: invoice.number || invoice.id,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate ?? null,
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
          attachments: [{ filename: invoicePdfFilename(invoice), content: pdf }],
        });
        // sendEmail no lanza: devuelve {ok:false} si Resend rechaza y
        // {dryRun:true} si no hay correo configurado. Dar por enviado sin
        // mirarlo era decirle al admin que el cliente tiene la factura.
        if (!envio.ok) {
          emailError = envio.error || "Resend rechazó el envío";
        } else if (envio.dryRun) {
          emailError = "Correo no configurado: la factura no ha salido (modo simulacro)";
        } else {
          emailEnviado = true;
        }
        if (emailError) process.stderr.write(`[billing:send] ${invoice.id}: ${emailError}\n`);
      } catch (mailErr) {
        emailError = mailErr.message;
        process.stderr.write(`[billing:send] email fail: ${mailErr.message}
`);
      }
    } else if (quiereEmail && !destino) {
      emailError = "El cliente no tiene email en su ficha";
    }

    const updates = { status: "sent" };
    updates.customFields = {
      ...(invoice.customFields || {}),
      sentVia: via || (emailEnviado ? "email" : "other"),
      sentAt: new Date().toISOString(),
      ...(emailEnviado ? { sentTo: destino } : {}),
    };
    await invoice.update(updates);

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.sent",
      entity: "Invoice",
      entityId: invoice.id,
      before: { status: "issued" },
      after: { status: "sent", via: via || (emailEnviado ? "email" : "other"), emailEnviado },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok({ ...withEffectiveStatus(invoice), emailEnviado, emailError });
  } catch (err) {
    return serverError(err);
  }
});

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}
