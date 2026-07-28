/**
 * bookingCancelled — una cita existente (confirmada o pendiente) se cancela
 * desde el CRM, con motivo opcional (2026-07-22; hasta hoy el motivo se
 * guardaba en BD pero el paciente nunca recibía correo).
 *
 * No confundir con bookingRejected (rechazo de una SOLICITUD que nunca llegó a
 * confirmarse): aquí el paciente tenía una cita y hay que avisarle de que ya no.
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
 *   reason?: string|null,
 * }} ctx
 */
export function bookingCancelledTemplate(ctx) {
  const dt = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  const subject = "Tu cita ha sido cancelada";
  const preheader = `La cita del ${dt} queda cancelada.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Te escribimos para avisarte de que tu cita de <strong>${ctx.eventTypeName}</strong> ha sido <strong>cancelada</strong>.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Fecha de la cita", value: dt },
  ];

  const parts = [];
  if (ctx.reason && ctx.reason.trim()) {
    parts.push(
      `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${ctx.reason.trim()}</p>`
    );
  }
  parts.push(
    `<p style="margin:0 0 12px;">Sentimos las molestias. Si quieres buscar una nueva fecha, responde a este email y la cuadramos.</p>`
  );

  const bodyHtml = parts.join("");
  const footer = `Gracias por tu comprensión. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Cita cancelada",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Tu cita de ${ctx.eventTypeName} ha sido cancelada.`,
    `Fecha de la cita: ${dt}.`,
  ];
  if (ctx.reason && ctx.reason.trim()) {
    textLines.push(``, `Motivo: ${ctx.reason.trim()}`);
  }
  textLines.push(
    ``,
    `Sentimos las molestias. Si quieres buscar una nueva fecha, responde a este email y la cuadramos.`,
    ``,
    `— ${ctx.tenantName}`
  );

  return { subject, html, text: textLines.join("\n") };
}
