/**
 * lib/citas/recordatorios.js — recordatorio automático de la víspera.
 *
 * (Fichero nuevo en /lib, regla #2: lo usan el ejecutor programado
 * scripts/enviar-recordatorios.js y cualquier disparo manual futuro.)
 *
 * QUÉ RESUELVE: el CRM no mandaba ningún recordatorio, aunque las citas ya
 * registran "no presentado". Una silla vacía es una hora perdida que no se
 * recupera, y para un centro como Aumenta (15 profesionales) eso es dinero
 * todas las semanas.
 *
 * CUÁNDO SE MANDA: a las citas que caen dentro de la ventana [ahora+18h,
 * ahora+30h]. Es deliberadamente ancha para que el ejecutor pueda correr una
 * vez por hora sin que una cita se escape por el borde, y `reminder_sent_at`
 * garantiza que cada persona reciba UNO y solo uno.
 *
 * QUIÉN LO RECIBE: solo citas CONFIRMADAS y futuras, con email. Nunca las
 * pendientes de confirmar (todavía no hay nada que recordar), ni las
 * canceladas, ni las de un tenant que no lo haya activado.
 *
 * OPT-IN POR TENANT (`settings.citas.recordatorios`): apagado por defecto.
 * Encenderlo hace que a partir de esa noche empiecen a salir correos hacia
 * pacientes reales; esa decisión es del cliente, no del CRM.
 */

import { Op } from "sequelize";
import { sendEmail } from "../email/resendClient.js";
import { bookingReminderTemplate } from "../email/templates/citas/bookingReminder.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";

const HORA = 60 * 60 * 1000;
export const VENTANA_DESDE_H = 18;
export const VENTANA_HASTA_H = 30;

/** ¿Este tenant quiere recordatorios? Apagado por defecto. */
export function recordatoriosActivos(tenant) {
  return tenant?.settings?.citas?.recordatorios === true;
}

/** URL pública para que el paciente cancele desde el email. */
function cancelUrl(baseUrl, slug, token) {
  if (!baseUrl || !token) return null;
  return `${String(baseUrl).replace(/\/$/, "")}/widget/c/${slug}/cancel/${token}`;
}

/**
 * Manda los recordatorios pendientes de UN tenant.
 *
 * @returns {{enviados:number, fallidos:number, candidatas:number, motivo?:string}}
 */
export async function enviarRecordatoriosDeTenant({ tenant, tenantModels, slug, baseUrl, simular = false }) {
  if (!recordatoriosActivos(tenant)) {
    return { enviados: 0, fallidos: 0, candidatas: 0, motivo: "desactivado" };
  }

  const { Booking, EventType } = tenantModels;
  if (!Booking) return { enviados: 0, fallidos: 0, candidatas: 0, motivo: "sin-citas" };

  const ahora = Date.now();
  const desde = new Date(ahora + VENTANA_DESDE_H * HORA);
  const hasta = new Date(ahora + VENTANA_HASTA_H * HORA);

  const citas = await Booking.findAll({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      scheduledAt: { [Op.between]: [desde, hasta] },
    },
    order: [["scheduledAt", "ASC"]],
    limit: 500,
  });

  let enviados = 0;
  let fallidos = 0;
  const resend = getTenantResendConfig({ tenant });

  for (const cita of citas) {
    if (!cita.clientEmail) continue;

    if (simular) {
      enviados += 1;
      continue;
    }

    try {
      const et = EventType ? await EventType.findByPk(cita.eventTypeId, { attributes: ["name", "location"] }) : null;
      const tpl = bookingReminderTemplate({
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        clientName: cita.clientName,
        eventTypeName: et?.name ?? "tu cita",
        scheduledAt: cita.scheduledAt,
        duration: cita.duration,
        modality: cita.modality,
        meetUrl: cita.meetUrl,
        location: et?.location ?? null,
        cancelUrl: cancelUrl(baseUrl, slug, cita.cancellationToken),
      });

      await sendEmail({
        to: cita.clientEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        from: resend.fromEmail || undefined,
        replyTo: resend.replyTo || undefined,
        apiKey: resend.apiKey || undefined,
      });

      // Se marca DESPUÉS de enviar: si el correo falla, se reintenta en la
      // pasada siguiente en vez de dar por avisada a una persona que no lo está.
      await cita.update({ reminderSentAt: new Date() });
      enviados += 1;
    } catch (err) {
      fallidos += 1;
      process.stderr.write(`[citas:recordatorio] ${cita.id}: ${err.message}\n`);
    }
  }

  return { enviados, fallidos, candidatas: citas.length };
}
