/**
 * bookingRejected — Laura ha decidido no aceptar la solicitud (PATCH
 * /api/citas/bookings/[id]/reject). Email educado con motivo opcional.
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
 *   websiteUrl?: string|null,    // por si quieres invitar a reservar otra fecha
 * }} ctx
 */
export function bookingRejectedTemplate(ctx) {
  const dt = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";

  const subject = "Sobre tu solicitud de cita";
  const preheader = `No podemos confirmar la cita del ${dt}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Lamentamos no poder confirmar tu solicitud para <strong>${escapeHtml(ctx.eventTypeName)}</strong> en la fecha que indicaste.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Fecha solicitada", value: dt },
  ];

  const parts = [];
  /*
   * Si la cita era de un BONO, lo primero es decirle que NO ha perdido el
   * programa (06/08/2026, Rodrigo). Un correo que solo dice que su cita queda
   * cancelada, a quien acaba de pagar diez sesiones, se lee como que le han
   * cancelado la compra.
   */
  if (ctx.esBono) {
    parts.push(
      `<p style="margin:0 0 12px;">Tu <strong>programa sigue activo</strong>: esta sesión vuelve a estar disponible y te daremos otra fecha. No pierdes ninguna sesión ni se te cobra nada de más.</p>`
    );
  }

  /*
   * Escapados (10/08/2026), mismo agujero que tenía bookingCancelled: el motivo
   * lo teclea una persona y acaba dentro de un HTML que se le manda al paciente.
   * La web del centro también la escribe un admin, y aquí va DENTRO de un href,
   * donde unas comillas se salen del atributo y lo que venga detrás ya es
   * marcado. Escapar un enlace no lo estropea: el "&" de la query pasa a
   * "&amp;", que es como se escribe un "&" dentro de un atributo, y el correo
   * lleva al mismo sitio de siempre (avisoCliente.js ya lo hace así con el
   * enlace del portal). El texto plano de más abajo se queda crudo.
   */
  if (ctx.reason && ctx.reason.trim()) {
    parts.push(
      `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(ctx.reason.trim())}</p>`
    );
  }
  if (ctx.websiteUrl) {
    parts.push(
      `<p style="margin:0 0 12px;">Puedes proponer otra fecha desde nuestra web: <a href="${escapeHtml(ctx.websiteUrl)}" style="color:inherit;">${escapeHtml(ctx.websiteUrl)}</a>.</p>`
    );
  } else {
    parts.push(
      `<p style="margin:0 0 12px;">Si quieres, responde a este email y buscamos juntos una alternativa.</p>`
    );
  }

  const bodyHtml = parts.join("");

  const footer = `Gracias por tu interés. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "No podemos atender tu solicitud",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Lamentamos no poder confirmar tu solicitud para ${ctx.eventTypeName}.`,
    `Fecha solicitada: ${dt}.`,
  ];

  if (ctx.esBono) {
    textLines.push(``, `Tu programa sigue activo: esta sesión vuelve a estar disponible y te daremos otra fecha.`);
  }

  if (ctx.reason && ctx.reason.trim()) {
    textLines.push(``, `Motivo: ${ctx.reason.trim()}`);
  }

  if (ctx.websiteUrl) {
    textLines.push(``, `Puedes proponer otra fecha desde: ${ctx.websiteUrl}`);
  } else {
    textLines.push(``, `Si quieres, responde a este email y buscamos juntos una alternativa.`);
  }

  textLines.push(``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
