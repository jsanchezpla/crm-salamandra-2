/**
 * bookingReceived — el paciente envía el formulario público y queda en
 * lista de espera. Le confirmamos que tenemos su solicitud y que Laura
 * (o quien sea) le contestará.
 *
 * Se dispara desde POST /api/public/c/[tenantSlug]/book SOLO cuando el
 * booking nace con status='pending'. Si el tenant tiene auto-confirm
 * (default), NO se envía este email: en su lugar se podría enviar
 * bookingConfirmed directamente (no implementado en este sprint —
 * apuntado al backlog).
 */

import { renderLayout } from "../layout.js";

function formatDateTime(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return String(scheduledAt);
  }
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName: string,
 *   eventTypeName: string,
 *   scheduledAt: string|Date,
 * }} ctx
 */
export function bookingReceivedTemplate(ctx) {
  const dt = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  const subject = "Hemos recibido tu solicitud de cita";
  const preheader = `Solicitud para ${ctx.eventTypeName} el ${dt}.`;

  const intro = `<p>Hola ${firstName},</p>
<p>Hemos recibido tu solicitud para <strong>${ctx.eventTypeName}</strong>. Está en cola y la revisamos lo antes posible — normalmente en las próximas horas o, como mucho, al día siguiente laborable.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Fecha propuesta", value: dt },
  ];

  const bodyHtml = `<p style="margin:0 0 6px;">Cuando confirmemos la cita recibirás otro email con todos los detalles. Si necesitas cambiar algo antes, responde a este mensaje y lo gestionamos.</p>`;

  const footer = `Este email es automático. Cualquier duda, responde y te leemos. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Solicitud recibida",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const text = [
    `Hola ${firstName},`,
    ``,
    `Hemos recibido tu solicitud para ${ctx.eventTypeName}.`,
    `Fecha propuesta: ${dt}.`,
    ``,
    `Está en cola y la revisamos lo antes posible (normalmente en horas).`,
    `Cuando confirmemos la cita recibirás otro email con los detalles.`,
    ``,
    `— ${ctx.tenantName}`,
  ].join("\n");

  return { subject, html, text };
}
