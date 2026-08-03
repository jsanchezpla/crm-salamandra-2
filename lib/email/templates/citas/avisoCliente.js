/**
 * avisoCliente — un mensaje que el centro escribe a un cliente concreto
 * (03/08/2026): «cierro en agosto», «tráete los análisis», «te llamo mañana».
 *
 * A diferencia del resto de correos de citas, aquí el texto lo escribe una
 * persona en ese momento; no hay plantilla que rellenar. Por eso este fichero
 * hace poco más que vestirlo con la marca del centro y recordar dónde vuelve a
 * encontrarlo.
 *
 * ⚠️ El cuerpo se ESCAPA y luego se convierten los saltos de línea en <br>. Va
 * dentro de un HTML que se le manda a otra persona: no puede colarse marcado.
 */

import { renderLayout, escapeHtml } from "../layout.js";

/** Texto de una persona → HTML seguro, conservando los párrafos. */
function textoAHtml(texto) {
  return escapeHtml(String(texto ?? "").trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName?: string|null,
 *   title: string,
 *   body: string,
 *   portalUrl?: string|null,
 * }} ctx
 */
export function avisoClienteTemplate(ctx) {
  const nombre = (ctx.clientName || "").split(" ")[0] || null;

  const subject = ctx.title;
  const preheader = String(ctx.body ?? "").trim().slice(0, 120);

  const intro = nombre
    ? `<p>Hola ${escapeHtml(nombre)},</p>`
    : `<p>Hola,</p>`;

  const parts = [textoAHtml(ctx.body)];
  if (ctx.portalUrl) {
    parts.push(
      `<p style="margin:16px 0 0;font-size:13px;">` +
      `También lo tienes guardado en tu área privada: ` +
      `<a href="${escapeHtml(ctx.portalUrl)}">${escapeHtml(ctx.portalUrl)}</a>` +
      `</p>`
    );
  }

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: ctx.title,
    intro,
    blocks: [],
    bodyHtml: parts.join(""),
    footer: `— ${ctx.tenantName}`,
  });

  const textLines = [
    nombre ? `Hola ${nombre},` : `Hola,`,
    ``,
    String(ctx.body ?? "").trim(),
  ];
  if (ctx.portalUrl) textLines.push(``, `También lo tienes en tu área privada: ${ctx.portalUrl}`);
  textLines.push(``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
