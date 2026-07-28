/**
 * bookingConfirmed — Laura ha confirmado la cita desde la lista de espera
 * (PATCH /api/citas/bookings/[id]/confirm). El email lleva fecha, hora,
 * modalidad y, si online, el enlace Meet placeholder (Sprint Fase 2
 * sustituye por Meet real vía Google Calendar).
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
 *   cancelUrl?: string|null,    // /widget/c/{slug}/cancel/{token}
 *   location?: string|null,     // si presencial
 * }} ctx
 */
export function bookingConfirmedTemplate(ctx) {
  const dateStr = formatDate(ctx.scheduledAt);
  const timeStr = formatTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";
  const modalityLabel = MODALITY_LABELS[ctx.modality] || ctx.modality;

  const subject = "Tu cita está confirmada";
  const preheader = `${ctx.eventTypeName} · ${dateStr} a las ${timeStr}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Te confirmamos tu cita de <strong>${ctx.eventTypeName}</strong>. ¡Nos vemos pronto!</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Día", value: dateStr },
    { label: "Hora", value: timeStr },
    { label: "Duración", value: ctx.duration ? `${ctx.duration} min` : null },
    { label: "Modalidad", value: modalityLabel },
  ].filter((b) => b.value);

  const lines = [];

  if (ctx.modality === "online" && ctx.meetUrl) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>Enlace de videollamada:</strong><br><a href="${ctx.meetUrl}" style="color:inherit;word-break:break-all;">${ctx.meetUrl}</a></p>`,
      `<p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Te recomendamos conectarte unos minutos antes para comprobar audio y cámara.</p>`
    );
  } else if (ctx.modality === "presencial" && ctx.location) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>Ubicación:</strong> ${ctx.location}</p>`
    );
  } else if (ctx.modality === "phone") {
    lines.push(
      `<p style="margin:0 0 12px;">Te llamaremos al teléfono que nos facilitaste a la hora indicada.</p>`
    );
  }

  if (ctx.cancelUrl) {
    lines.push(
      `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;">¿No puedes asistir? <a href="${ctx.cancelUrl}" style="color:inherit;">Cancela aquí</a> y reservamos otro hueco.</p>`
    );
  }

  const bodyHtml = lines.join("");

  const footer = `Si necesitas hacer cambios, responde a este email. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Cita confirmada",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Tu cita de ${ctx.eventTypeName} está confirmada.`,
    `Día: ${dateStr}`,
    `Hora: ${timeStr}`,
    ctx.duration ? `Duración: ${ctx.duration} min` : null,
    `Modalidad: ${modalityLabel}`,
  ].filter(Boolean);

  if (ctx.modality === "online" && ctx.meetUrl) {
    textLines.push(``, `Videollamada: ${ctx.meetUrl}`);
  } else if (ctx.modality === "presencial" && ctx.location) {
    textLines.push(``, `Ubicación: ${ctx.location}`);
  } else if (ctx.modality === "phone") {
    textLines.push(``, `Te llamaremos al teléfono indicado.`);
  }

  if (ctx.cancelUrl) {
    textLines.push(``, `Cancelar: ${ctx.cancelUrl}`);
  }

  textLines.push(``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
