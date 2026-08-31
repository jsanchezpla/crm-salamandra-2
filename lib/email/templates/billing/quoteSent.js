/**
 * quoteSent — envío de un presupuesto al cliente con el PDF adjunto
 * (31/08/2026). Hermana de `invoiceSent.js` y con su mismo tono sobrio: hasta
 * hoy el botón de presupuestos solo MARCABA como enviado y el papel viajaba a
 * mano desde el correo personal.
 */

import { renderLayout, escapeHtml } from "../layout.js";

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return String(v);
  }
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName?: string,
 *   quoteNumber: string,
 *   issueDate?: string|Date,
 *   validUntil?: string|Date|null,
 *   total: string,
 * }} ctx
 */
export function quoteSentTemplate(ctx) {
  const nombre = (ctx.clientName || "").trim().split(" ")[0] || null;
  const numero = escapeHtml(ctx.quoteNumber);

  const subject = `Presupuesto ${ctx.quoteNumber} · ${ctx.tenantName}`;
  const preheader = `Adjuntamos el presupuesto ${ctx.quoteNumber} por ${ctx.total}.`;

  const intro = `<p>${nombre ? `Hola ${escapeHtml(nombre)},` : "Hola,"}</p>
<p>Te adjuntamos el presupuesto <strong>${numero}</strong> en PDF.</p>`;

  const blocks = [
    { label: "Nº de presupuesto", value: ctx.quoteNumber },
    { label: "Fecha", value: formatDate(ctx.issueDate) },
    ...(ctx.validUntil ? [{ label: "Válido hasta", value: formatDate(ctx.validUntil) }] : []),
    { label: "Total", value: ctx.total },
  ];

  const text = [
    nombre ? `Hola ${nombre},` : "Hola,",
    "",
    `Te adjuntamos el presupuesto ${ctx.quoteNumber} en PDF.`,
    "",
    `Nº de presupuesto: ${ctx.quoteNumber}`,
    `Fecha: ${formatDate(ctx.issueDate)}`,
    ...(ctx.validUntil ? [`Válido hasta: ${formatDate(ctx.validUntil)}`] : []),
    `Total: ${ctx.total}`,
    "",
    "Si tienes cualquier duda, responde a este correo.",
    "",
    ctx.tenantName,
  ].join("\n");

  return {
    subject,
    text,
    html: renderLayout({
      tenantName: ctx.tenantName,
      brand: ctx.brand,
      preheader,
      title: `Presupuesto ${ctx.quoteNumber}`,
      intro,
      blocks,
      footer: "Si tienes cualquier duda con este presupuesto, responde a este correo y te contestamos.",
    }),
  };
}
