/**
 * bookingRescheduled — la cita se MUEVE de día u hora desde el CRM
 * (2026-08-03; hasta hoy no salía ningún correo).
 *
 * Era el hueco más silencioso de los tres avisos: cancelar sí escribía, pero
 * cambiar la hora no. La cita simplemente aparecía otro día en el portal, y el
 * paciente solo se enteraba si entraba a mirar. La gente se presenta el día que
 * le dijeron, no el día que pone en una pantalla que no ha abierto.
 *
 * Se enseñan las DOS fechas, la vieja tachada y la nueva destacada: decir solo
 * la nueva obliga a recordar cuál era la anterior para entender qué ha pasado.
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
 *   scheduledAtAnterior: string|Date,
 *   scheduledAt: string|Date,
 *   reason?: string|null,
 * }} ctx
 */
export function bookingRescheduledTemplate(ctx) {
  const antes = formatDateTime(ctx.scheduledAtAnterior);
  const ahora = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  const subject = "Han cambiado la fecha de tu cita";
  const preheader = `Tu cita pasa a ser el ${ahora}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Te escribimos para avisarte de que tu cita de <strong>${escapeHtml(ctx.eventTypeName)}</strong> ha cambiado de fecha.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Antes era", value: antes },
    { label: "Ahora es", value: ahora },
  ];

  const parts = [];
  if (ctx.reason && ctx.reason.trim()) {
    // Escapado: el motivo lo teclea una persona y acaba dentro de un HTML.
    parts.push(`<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(ctx.reason.trim())}</p>`);
  }
  parts.push(
    `<p style="margin:0 0 12px;"><strong>Apunta la fecha nueva.</strong> Si no te viene bien, responde a este email y buscamos otra.</p>`
  );

  const bodyHtml = parts.join("");
  const footer = `Gracias. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Tu cita ha cambiado de fecha",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Tu cita de ${ctx.eventTypeName} ha cambiado de fecha.`,
    ``,
    `Antes era: ${antes}`,
    `Ahora es:  ${ahora}`,
  ];
  if (ctx.reason && ctx.reason.trim()) textLines.push(``, `Motivo: ${ctx.reason.trim()}`);
  textLines.push(
    ``,
    `Apunta la fecha nueva. Si no te viene bien, responde a este email y buscamos otra.`,
    ``,
    `— ${ctx.tenantName}`
  );

  return { subject, html, text: textLines.join("\n") };
}
