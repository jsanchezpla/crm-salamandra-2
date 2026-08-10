/**
 * bookingReminder — recordatorio automático la víspera de la cita.
 *
 * QUÉ RESUELVE: el CRM no tenía NINGÚN recordatorio, pese a que las citas
 * registran el estado "no presentado". Es el correo que más dinero ahorra a un
 * centro (una silla vacía es una hora perdida que ya no se recupera) y lo que
 * cualquiera espera de una consulta hoy.
 *
 * Se escribe en tono de servicio, no de aviso administrativo, y SIEMPRE lleva
 * el enlace de cancelación: el objetivo no es solo que la persona venga, es que
 * si no puede venir lo diga a tiempo y ese hueco se libere para otro.
 */

import { renderLayout, escapeHtml } from "../layout.js";

function formatDate(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
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

const MODALITY_LABELS = {
  presencial: "Presencial",
  phone: "Llamada telefónica",
  online: "Online (videollamada)",
};

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName: string,
 *   eventTypeName: string,
 *   scheduledAt: string|Date,
 *   duration?: number,
 *   modality: "presencial"|"phone"|"online",
 *   meetUrl?: string|null,
 *   cancelUrl?: string|null,
 *   location?: string|null,
 * }} ctx
 */
export function bookingReminderTemplate(ctx) {
  const dateStr = formatDate(ctx.scheduledAt);
  const timeStr = formatTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";
  const modalityLabel = MODALITY_LABELS[ctx.modality] || ctx.modality;

  const subject = `Recordatorio: tu cita es mañana a las ${timeStr}`;
  const preheader = `${ctx.eventTypeName} · ${dateStr} a las ${timeStr}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Te recordamos que <strong>mañana</strong> tienes tu cita de <strong>${escapeHtml(ctx.eventTypeName)}</strong>.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Día", value: dateStr },
    { label: "Hora", value: timeStr },
    { label: "Duración", value: ctx.duration ? `${ctx.duration} min` : null },
    { label: "Modalidad", value: modalityLabel },
  ].filter((b) => b.value);

  const lines = [];

  // Escapados (10/08/2026), mismo repaso que bookingConfirmed. Aquí pesa más:
  // este correo lo dispara el cron de recordatorios de madrugada, sin nadie
  // delante que note que un mensaje ha salido raro.
  if (ctx.modality === "online" && ctx.meetUrl) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>Enlace de videollamada:</strong><br><a href="${escapeHtml(ctx.meetUrl)}" style="color:inherit;word-break:break-all;">${escapeHtml(ctx.meetUrl)}</a></p>`,
      `<p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Conéctate unos minutos antes para comprobar audio y cámara.</p>`
    );
  } else if (ctx.modality === "presencial" && ctx.location) {
    lines.push(`<p style="margin:0 0 12px;"><strong>Dónde:</strong> ${escapeHtml(ctx.location)}</p>`);
  } else if (ctx.modality === "phone") {
    lines.push(`<p style="margin:0 0 12px;">Te llamaremos al teléfono que nos facilitaste a la hora indicada.</p>`);
  }

  if (ctx.cancelUrl) {
    lines.push(
      `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;">¿No puedes venir? <a href="${escapeHtml(ctx.cancelUrl)}" style="color:inherit;">Avísanos aquí</a> cuanto antes y así podemos ofrecer tu hueco a otra persona.</p>`
    );
  }

  const textLines = [
    `Hola ${firstName},`,
    "",
    `Te recordamos que mañana tienes tu cita de ${ctx.eventTypeName}.`,
    "",
    `Día: ${dateStr}`,
    `Hora: ${timeStr}`,
    ...(ctx.duration ? [`Duración: ${ctx.duration} min`] : []),
    `Modalidad: ${modalityLabel}`,
  ];
  if (ctx.modality === "online" && ctx.meetUrl) textLines.push("", `Enlace: ${ctx.meetUrl}`);
  if (ctx.modality === "presencial" && ctx.location) textLines.push("", `Dónde: ${ctx.location}`);
  if (ctx.cancelUrl) textLines.push("", `Si no puedes venir, avísanos: ${ctx.cancelUrl}`);
  textLines.push("", ctx.tenantName);

  return {
    subject,
    text: textLines.join("\n"),
    html: renderLayout({
      tenantName: ctx.tenantName,
      brand: ctx.brand,
      preheader,
      title: "Tu cita es mañana",
      intro,
      blocks,
      bodyHtml: lines.join("\n"),
    }),
  };
}
