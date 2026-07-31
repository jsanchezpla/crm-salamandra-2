/**
 * pedirTarjeta — "necesitamos que vuelvas a introducir tu tarjeta".
 *
 * Se manda cuando la reserva que había en su tarjeta ya no vale: o caducó (las
 * retenciones mueren a los ~7 días) o el banco rechazó el cobro. La cita SIGUE
 * EN PIE; lo único que falta es el dinero.
 *
 * El tono importa. Para el paciente esto es "algo ha fallado con mi pago", que
 * es la clase de correo que da miedo abrir. Así que dice, en este orden: tu cita
 * no se ha perdido, no se te ha cobrado nada, y esto se arregla en un minuto.
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
 *   importe: number,        CÉNTIMOS
 *   enlace: string,         URL absoluta al formulario de tarjeta
 *   motivo?: "caducada"|"rechazada"|null,
 * }} ctx
 */
export function pedirTarjetaTemplate(ctx) {
  const dt = formatDateTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";
  const importe = (ctx.importe / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

  // El motivo real se le dice en cristiano y sin culparle. "Tu banco rechazó la
  // operación" no le sirve de nada y suena a acusación; lo que necesita saber es
  // qué tiene que hacer.
  const porque =
    ctx.motivo === "rechazada"
      ? "No hemos podido completar el cobro con la tarjeta que nos diste."
      : "La reserva que teníamos en tu tarjeta ha caducado (solo se mantiene unos días).";

  const subject = "Necesitamos tu tarjeta otra vez para tu cita";
  const preheader = `Tu cita del ${dt} sigue en pie. No se te ha cobrado nada.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p><strong>Tu cita sigue en pie</strong>, no la hemos cancelado. ${escapeHtml(porque)}</p>`;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Cuándo", value: dt },
    { label: "Importe", value: importe },
  ];

  const bodyHtml = `<p style="margin:0 0 14px;">Para confirmarla solo hace falta que vuelvas a introducir una tarjeta. Es un minuto:</p>
<p style="margin:0 0 16px;"><a href="${ctx.enlace}" style="display:inline-block;padding:11px 20px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none;font-weight:500;">Introducir mi tarjeta</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#6B7280;">Como la otra vez, <strong>no se te cobrará nada todavía</strong>: se reservan ${escapeHtml(importe)} en tu tarjeta y solo se cobran cuando confirmemos la cita.</p>
<p style="margin:0;font-size:13px;color:#6B7280;">Si prefieres pagar en la consulta o ya no te viene bien, responde a este correo y lo vemos.</p>`;

  const footer = `El enlace caduca en unos días. Cualquier duda, responde y te leemos. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Tu tarjeta, otra vez",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const text = [
    `Hola ${firstName},`,
    ``,
    `TU CITA SIGUE EN PIE, no la hemos cancelado.`,
    porque,
    ``,
    `Servicio: ${ctx.eventTypeName}`,
    `Cuándo: ${dt}`,
    `Importe: ${importe}`,
    ``,
    `Para confirmarla, vuelve a introducir una tarjeta aquí:`,
    ctx.enlace,
    ``,
    `Como la otra vez, no se te cobrará nada todavía: se reservan ${importe} en tu`,
    `tarjeta y solo se cobran cuando confirmemos la cita.`,
    ``,
    `Si prefieres pagar en consulta o ya no te viene bien, responde a este correo.`,
    ``,
    `— ${ctx.tenantName}`,
  ].join("\n");

  return { subject, html, text };
}
