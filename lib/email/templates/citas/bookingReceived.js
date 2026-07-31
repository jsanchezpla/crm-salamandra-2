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

import { renderLayout, escapeHtml } from "../layout.js";

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
 *   retenido?: number|null,   CÉNTIMOS retenidos en su tarjeta, si los hay
 * }} ctx
 */
export function bookingReceivedTemplate(ctx) {
  const dt = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  // ── EL PÁRRAFO QUE EVITA LA LLAMADA ──────────────────────────────────────
  // Con retención de tarjeta, el banco del paciente le enseña el importe como
  // cargo PENDIENTE, y muchos bancos no lo distinguen de un cobro. Si este
  // correo no lo explica, la primera reacción es "me han cobrado sin confirmar
  // la cita". Se dice antes de que lo vea, no después.
  const hayRetencion = Number.isInteger(ctx.retenido) && ctx.retenido > 0;
  const importe = hayRetencion
    ? (ctx.retenido / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })
    : null;

  const subject = "Hemos recibido tu solicitud de cita";
  const preheader = hayRetencion
    ? `Solicitud para ${ctx.eventTypeName} el ${dt}. Todavía no te hemos cobrado.`
    : `Solicitud para ${ctx.eventTypeName} el ${dt}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Hemos recibido tu solicitud para <strong>${escapeHtml(ctx.eventTypeName)}</strong>. Está en cola y la revisamos lo antes posible — normalmente en las próximas horas o, como mucho, al día siguiente laborable.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Fecha propuesta", value: dt },
    ...(hayRetencion ? [{ label: "Reservado en tu tarjeta", value: `${importe} (sin cobrar)` }] : []),
  ];

  const bodyHtml = hayRetencion
    ? `<p style="margin:0 0 10px;"><strong>Todavía no te hemos cobrado nada.</strong> Hemos reservado ${escapeHtml(importe)} en tu tarjeta para guardarte la hora. Es posible que tu banco te lo muestre como un cargo pendiente: no lo es.</p>
<p style="margin:0 0 10px;">Solo se te cobrará cuando confirmemos la cita. Si no podemos atenderte, ese importe se libera solo y no tienes que hacer nada.</p>
<p style="margin:0 0 6px;">Cuando confirmemos recibirás otro email con todos los detalles. Si necesitas cambiar algo antes, responde a este mensaje y lo gestionamos.</p>`
    : `<p style="margin:0 0 6px;">Cuando confirmemos la cita recibirás otro email con todos los detalles. Si necesitas cambiar algo antes, responde a este mensaje y lo gestionamos.</p>`;

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
    ...(hayRetencion
      ? [
          `TODAVÍA NO TE HEMOS COBRADO NADA.`,
          `Hemos reservado ${importe} en tu tarjeta para guardarte la hora.`,
          `Tu banco puede mostrarlo como un cargo pendiente: no lo es.`,
          `Solo se te cobrará cuando confirmemos la cita. Si no podemos atenderte,`,
          `ese importe se libera solo y no tienes que hacer nada.`,
          ``,
        ]
      : []),
    `Está en cola y la revisamos lo antes posible (normalmente en horas).`,
    `Cuando confirmemos la cita recibirás otro email con los detalles.`,
    ``,
    `— ${ctx.tenantName}`,
  ].join("\n");

  return { subject, html, text };
}
