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
<p>Te escribimos para avisarte de que tu cita de <strong>${escapeHtml(ctx.eventTypeName)}</strong> ha sido <strong>cancelada</strong>.</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Fecha de la cita", value: dt },
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
   * El motivo va ESCAPADO (10/08/2026). Lo teclea la profesional en el CRM y
   * sale disparado al correo del paciente sin que lo mire nadie por el camino.
   * Iba crudo: un "<" mal puesto rompía el HTML del mensaje, y un motivo
   * copiado y pegado de cualquier sitio podía meter marcado —un enlace, una
   * imagen— en un correo que sale del dominio verificado del centro. El saludo
   * de ahí arriba y los bloques de datos (esos los escapa renderLayout) ya iban
   * protegidos; el motivo era justo el único campo de texto libre que se quedó
   * fuera. Mismo patrón que avisoCliente.js y bookingRescheduled.js.
   *
   * OJO: la versión de TEXTO PLANO de más abajo NO se escapa, y no debe
   * hacerlo. Ahí no hay HTML que romper y un "&amp;" se leería con las letras.
   */
  if (ctx.reason && ctx.reason.trim()) {
    parts.push(
      `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(ctx.reason.trim())}</p>`
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
  if (ctx.esBono) {
    textLines.push(``, `Tu programa sigue activo: esta sesión vuelve a estar disponible y te daremos otra fecha.`);
  }

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
