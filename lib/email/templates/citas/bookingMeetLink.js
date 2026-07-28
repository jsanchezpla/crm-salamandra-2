/**
 * bookingMeetLink — el tenant ha añadido (por primera vez) el enlace de
 * videollamada a una cita online. Se dispara al detectar la transición
 * meetUrl null→valor en PATCH /api/citas/bookings/[id]. El cliente recibe el
 * enlace por email (y lo verá también en "Mis citas" si la cita está
 * confirmada + online).
 */

import { renderLayout, escapeHtml } from "../layout.js";

function formatDate(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return String(scheduledAt);
  }
}

function formatTime(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return "";
  }
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName: string,
 *   eventTypeName: string,
 *   scheduledAt: string|Date,
 *   duration?: number,
 *   meetUrl: string,
 *   cancelUrl?: string|null,
 * }} ctx
 */
export function bookingMeetLinkTemplate(ctx) {
  const dateStr = formatDate(ctx.scheduledAt);
  const timeStr = formatTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  const subject = "Enlace para tu videollamada";
  const preheader = `${ctx.eventTypeName} · ${dateStr} a las ${timeStr}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Ya tienes el enlace para conectarte a tu cita de <strong>${ctx.eventTypeName}</strong>.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Día", value: dateStr },
    { label: "Hora", value: timeStr },
    { label: "Duración", value: ctx.duration ? `${ctx.duration} min` : null },
  ].filter((b) => b.value);

  const lines = [
    `<p style="margin:0 0 12px;"><strong>Enlace de videollamada:</strong><br><a href="${ctx.meetUrl}" style="color:inherit;word-break:break-all;">${ctx.meetUrl}</a></p>`,
    `<p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Te recomendamos conectarte unos minutos antes para comprobar audio y cámara.</p>`,
  ];

  if (ctx.cancelUrl) {
    lines.push(
      `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;">¿No puedes asistir? <a href="${ctx.cancelUrl}" style="color:inherit;">Cancela aquí</a> y reservamos otro hueco.</p>`
    );
  }

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Enlace de videollamada",
    intro,
    blocks,
    bodyHtml: lines.join(""),
    footer: `Si necesitas hacer cambios, responde a este email. — ${ctx.tenantName}`,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Ya tienes el enlace para tu cita de ${ctx.eventTypeName}.`,
    `Día: ${dateStr}`,
    `Hora: ${timeStr}`,
    ``,
    `Videollamada: ${ctx.meetUrl}`,
  ];
  if (ctx.cancelUrl) textLines.push(``, `Cancelar: ${ctx.cancelUrl}`);
  textLines.push(``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
