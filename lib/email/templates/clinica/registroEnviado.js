/**
 * registroEnviado — el correo que avisa a la familia de que tiene un registro
 * de sesión nuevo en su área privada (04/09/2026, Rodrigo).
 *
 * El texto lo escribe (o lo repasa) una persona: `lib/clinica/correoRegistro.js`
 * propone un resumen a partir de la Devolución a la familia y quien envía lo
 * puede cambiar entero antes de mandarlo. Aquí solo se viste con la marca del
 * centro y se recuerda dónde está el documento completo — el mismo trato que
 * `citas/avisoCliente.js`, del que copia la mecánica.
 *
 * **El PDF NO se adjunta a propósito.** Es un documento clínico de un menor: va
 * al área privada, que pide identificarse, y no a un adjunto que se reenvía sin
 * pensar. El correo avisa y resume; el documento se recoge allí.
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
 *   asunto: string,
 *   texto: string,
 *   portalUrl?: string|null,
 * }} ctx
 */
export function registroEnviadoTemplate(ctx) {
  const subject = ctx.asunto || "Registro de sesión";
  const preheader = String(ctx.texto ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

  const parts = [textoAHtml(ctx.texto)];
  if (ctx.portalUrl) {
    parts.push(
      `<p style="margin:16px 0 0;font-size:13px;">` +
        `El registro completo está en tu área privada: ` +
        `<a href="${escapeHtml(ctx.portalUrl)}">${escapeHtml(ctx.portalUrl)}</a>` +
        `</p>`
    );
  }

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: subject,
    blocks: [],
    bodyHtml: parts.join(""),
    footer: `— ${ctx.tenantName}`,
  });

  // La versión en texto plano: el mismo cuerpo, sin vestir. Va para los
  // lectores que no pintan HTML y para el dry-run del log.
  const lineas = [String(ctx.texto ?? "").trim()];
  if (ctx.portalUrl) lineas.push("", `El registro completo está en tu área privada: ${ctx.portalUrl}`);

  return { subject, html, text: lineas.join("\n") };
}
