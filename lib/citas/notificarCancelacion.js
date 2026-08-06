/**
 * lib/citas/notificarCancelacion.js — el aviso por email de una cita cancelada.
 *
 * (Fichero nuevo en /lib, regla #2: hasta ahora esta lógica vivía DENTRO del
 * endpoint del panel, así que las cancelaciones hechas por el propio paciente
 * —desde el enlace de su email o desde su portal— se quedaban MUDAS. Al
 * extraerlo aquí, los tres caminos de cancelación avisan igual.)
 *
 * BUG QUE CIERRA (crítico, detectado en la auditoría del 2026-07-27): una
 * paciente de tunutrilaura cancelaba su cita desde el enlace del correo y
 * Laura no recibía ningún aviso; y al revés, una cita cancelada desde el
 * portal no generaba ninguna notificación. Ahora:
 *   - al cliente: email de "tu cita ha sido cancelada" (solo si la cancela el
 *     CENTRO — si la cancela él mismo ya lo sabe, sería ruido),
 *   - al centro: aviso en la campana del CRM cuando cancela el cliente.
 *
 * Best-effort en todo: un fallo de email o de campana JAMÁS rompe la
 * cancelación, que es la operación que de verdad importa.
 */

import { sendEmail, envioRealizado } from "../email/resendClient.js";
import { bookingCancelledTemplate } from "../email/templates/citas/bookingCancelled.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { getMasterModels } from "../db/masterDb.js";

/** Solo se avisa de citas FUTURAS: limpiar historial antiguo no manda nada. */
function esFutura(booking) {
  return new Date(booking.scheduledAt).getTime() > Date.now();
}

/**
 * Email al cliente avisando de que su cita queda cancelada.
 * Se llama cuando cancela el CENTRO (no cuando cancela él).
 */
export async function emailCancelacionAlCliente({ tenant, tenantModels, booking, reason }) {
  try {
    if (!booking?.clientEmail || !esFutura(booking)) return;

    const { EventType } = tenantModels;
    const et = EventType ? await EventType.findByPk(booking.eventTypeId, { attributes: ["name"] }) : null;
    const tpl = bookingCancelledTemplate({
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
      clientName: booking.clientName,
      eventTypeName: et?.name ?? "tu cita",
      scheduledAt: booking.scheduledAt,
      reason: reason ?? null,
      // Su bono no se toca al cancelar una sesión: hay que decírselo.
      esBono: !!booking.packId,
    });
    const resend = getTenantResendConfig({ tenant });
    const envio = await sendEmail({
      to: booking.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      // undefined → sendEmail cae a las credenciales globales del CRM.
      from: resend.fromEmail || undefined,
      replyTo: resend.replyTo || undefined,
      apiKey: resend.apiKey || undefined,
    });
    envioRealizado(envio, `citas:cancelada ${booking.id}`);
  } catch (err) {
    process.stderr.write(`[citas:cancelada] email al cliente falló: ${err.message}\n`);
  }
}

/**
 * Campana a los admins del tenant cuando es el CLIENTE quien cancela.
 * Antes esto no existía: la cita desaparecía de la agenda sin avisar a nadie.
 */
export async function avisarCentroDeCancelacion({ tenant, tenantModels, booking }) {
  try {
    const { Notification } = tenantModels;
    if (!Notification) return;

    const cuando = new Date(booking.scheduledAt).toLocaleString("es-ES", {
      timeZone: "Europe/Madrid",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const { User } = getMasterModels();
    const admins = await User.findAll({
      where: { tenantId: tenant.id, role: "admin" },
      attributes: ["id"],
    });

    for (const admin of admins) {
      await Notification.create({
        userId: admin.id,
        channel: "app",
        type: "booking_cancelled_by_client",
        title: "Cita cancelada por el cliente",
        body: `${booking.clientName || booking.clientEmail} ha cancelado su cita del ${cuando}.`,
        entityType: "Booking",
        entityId: booking.id,
      });
    }
  } catch (err) {
    process.stderr.write(`[citas:cancelada] aviso al centro falló: ${err.message}\n`);
  }
}
