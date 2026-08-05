/**
 * solicitudAceptada — «ya puedes pedir cita» (05/08/2026).
 *
 * Nace de una decisión de producto: la puerta de admisión exige el formulario
 * **aceptado**, no solo enviado. Entre rellenar y poder reservar hay una
 * persona decidiendo, así que el «continuar automáticamente hacia la reserva»
 * que se pidió no existe — el paciente rellena y espera.
 *
 * Y hasta hoy esperaba a ciegas: al aceptar una solicitud se creaba su ficha,
 * se le daba de alta en la web y no se le decía NADA. Se quedaba sin saber que
 * ya podía pedir cita; volvía o no volvía.
 *
 * Este correo es la continuación posible: cierra la espera y trae de vuelta a
 * quien ya había dado el paso de rellenar. Va con el enlace directo a reservar,
 * porque pedirle que busque la página otra vez es perderlo por segunda vez.
 */

import { renderLayout, escapeHtml } from "../layout.js";

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName?: string|null,
 *   urlReserva?: string|null,
 * }} ctx
 */
export function solicitudAceptadaTemplate(ctx) {
  const nombre = (ctx.clientName || "").split(" ")[0] || null;

  const subject = `Ya puedes pedir tu cita — ${ctx.tenantName}`;
  const preheader = "Hemos revisado lo que nos contaste y tienes la agenda abierta.";

  const intro = nombre
    ? `<p>Hola ${escapeHtml(nombre)},</p>`
    : `<p>Hola,</p>`;

  const parts = [
    `<p style="margin:0 0 12px;">Hemos leído lo que nos contaste y ya puedes reservar tu cita.</p>`,
  ];

  if (ctx.urlReserva) {
    parts.push(
      `<p style="margin:18px 0;">` +
      `<a href="${escapeHtml(ctx.urlReserva)}" ` +
      `style="display:inline-block;padding:12px 22px;border-radius:8px;background:#1B3A2D;color:#ffffff;` +
      `text-decoration:none;font-weight:600;">Pedir cita</a>` +
      `</p>`
    );
  } else {
    // Sin enlace configurado no se promete un botón que no lleva a ningún sitio.
    parts.push(
      `<p style="margin:0 0 12px;">Entra en la web y elige el hueco que mejor te venga.</p>`
    );
  }

  parts.push(
    `<p style="margin:0;font-size:13px;color:#6B7280;">` +
    `Si tienes cualquier duda, responde a este correo.</p>`
  );

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Ya puedes pedir tu cita",
    intro,
    blocks: [],
    bodyHtml: parts.join(""),
    footer: `Te esperamos. — ${ctx.tenantName}`,
  });

  const textLines = [
    nombre ? `Hola ${nombre},` : `Hola,`,
    ``,
    `Hemos leído lo que nos contaste y ya puedes reservar tu cita.`,
  ];
  if (ctx.urlReserva) textLines.push(``, `Pedir cita: ${ctx.urlReserva}`);
  textLines.push(``, `Si tienes cualquier duda, responde a este correo.`, ``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
