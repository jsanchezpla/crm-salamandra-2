/**
 * invoiceSent — envío de una factura al cliente con el PDF adjunto.
 *
 * QUÉ RESUELVE: el botón "Enviar" de Facturación solo MARCABA la factura como
 * enviada ("Sin integraciones reales todavía", decía el propio código). El PDF
 * ya se generaba y el correo ya funcionaba: solo faltaba juntarlos. Hasta hoy
 * había que descargar el PDF y mandarlo a mano desde el correo personal.
 *
 * Tono deliberadamente sobrio: es un documento contable, no una campaña.
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
 *   invoiceNumber: string,
 *   issueDate?: string|Date,
 *   dueDate?: string|Date|null,
 *   total: string,
 *   mensaje?: string|null,
 * }} ctx
 */
export function invoiceSentTemplate(ctx) {
  const nombre = (ctx.clientName || "").trim().split(" ")[0] || null;
  const numero = escapeHtml(ctx.invoiceNumber);

  const subject = `Factura ${ctx.invoiceNumber} · ${ctx.tenantName}`;
  const preheader = `Adjuntamos la factura ${ctx.invoiceNumber} por ${ctx.total}.`;

  const intro = `<p>${nombre ? `Hola ${escapeHtml(nombre)},` : "Hola,"}</p>
<p>Te adjuntamos la factura <strong>${numero}</strong> en PDF.</p>`;

  const blocks = [
    { label: "Nº de factura", value: ctx.invoiceNumber },
    { label: "Fecha", value: formatDate(ctx.issueDate) },
    ...(ctx.dueDate ? [{ label: "Vencimiento", value: formatDate(ctx.dueDate) }] : []),
    { label: "Total", value: ctx.total },
  ];

  const mensaje = ctx.mensaje && String(ctx.mensaje).trim()
    ? `<p style="margin:0 0 12px">${escapeHtml(String(ctx.mensaje).trim()).replace(/\n/g, "<br>")}</p>`
    : "";

  const text = [
    nombre ? `Hola ${nombre},` : "Hola,",
    "",
    `Te adjuntamos la factura ${ctx.invoiceNumber} en PDF.`,
    "",
    `Nº de factura: ${ctx.invoiceNumber}`,
    `Fecha: ${formatDate(ctx.issueDate)}`,
    ...(ctx.dueDate ? [`Vencimiento: ${formatDate(ctx.dueDate)}`] : []),
    `Total: ${ctx.total}`,
    "",
    ...(ctx.mensaje && String(ctx.mensaje).trim() ? [String(ctx.mensaje).trim(), ""] : []),
    "Si tienes cualquier duda con esta factura, responde a este correo.",
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
      title: `Factura ${ctx.invoiceNumber}`,
      intro,
      blocks,
      bodyHtml: mensaje,
      footer: "Si tienes cualquier duda con esta factura, responde a este correo y te contestamos.",
    }),
  };
}
