/**
 * cambioAplicado — recibo de un cambio en la configuración del negocio.
 *
 * Se manda al administrador del cliente cada vez que se toca su configuración,
 * la haya tocado él o la hayamos tocado nosotros. Es la pieza que convierte
 * "confía en que no tocamos nada" en algo que él puede comprobar.
 *
 * NUNCA lleva valores de credenciales, solo qué campo cambió y cómo. Un correo
 * es un canal que no controlamos: acaba en su bandeja, en su copia de seguridad
 * y en el antivirus de su proveedor.
 */

import { renderLayout, escapeHtml } from "../layout.js";

// Nombres que entiende un cliente, no los del código.
const NOMBRES = {
  anthropicApiKey: "Clave de IA (Anthropic)",
  googlePlacesApiKey: "Clave de Google Places",
  openaiApiKey: "Clave de OpenAI (transcripción)",
  resendApiKey: "Clave de envío de correo",
  stripeSecretKey: "Clave secreta de Stripe (cobros)",
  stripeWebhookSecret: "Secreto del webhook de Stripe",
  whatsappToken: "Token de WhatsApp",
  anthropicModel: "Modelo de IA",
  resendFromEmail: "Remitente del correo",
  resendReplyTo: "Dirección de respuesta",
  stripePublishableKey: "Clave publicable de Stripe",
  whatsappPhoneNumberId: "Número de WhatsApp",
  name: "Nombre del negocio",
  aiAccess: "Acceso del equipo a la IA",
  "brand.primaryColor": "Color principal",
  "brand.secondaryColor": "Color secundario",
  "brand.logoUrl": "Logotipo",
  "citas.meetModo": "Modo de videollamada",
  "citas.recordatorios": "Recordatorio de citas",
};

const QUE_PASO = {
  puesta: "se ha configurado",
  cambiada: "se ha sustituido",
  borrada: "se ha eliminado",
};

const bonito = (clave) => NOMBRES[clave] ?? clave;

function comoTexto(v) {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (v === true) return "activado";
  if (v === false) return "desactivado";
  return String(v);
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   before?: object|null,
 *   after?: object|null,
 *   autor?: string|null,      // quién lo hizo (email), si se sabe
 *   cuando?: Date,
 *   contacto?: string|null,   // a dónde escribir si no lo reconoce
 * }} ctx
 */
export function cambioConfiguracionTemplate(ctx) {
  const after = ctx.after ?? {};
  const before = ctx.before ?? {};
  const credenciales = after.credenciales ?? null;

  const cuando = (ctx.cuando ?? new Date()).toLocaleString("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  });

  // Las credenciales van primero: es lo que de verdad importa vigilar.
  const lineas = [];
  if (credenciales) {
    for (const [campo, accion] of Object.entries(credenciales)) {
      lineas.push({
        etiqueta: bonito(campo),
        detalle: QUE_PASO[accion] ?? accion,
        sensible: true,
      });
    }
  }
  for (const clave of Object.keys(after)) {
    if (clave === "credenciales") continue;
    lineas.push({
      etiqueta: bonito(clave),
      detalle: `${comoTexto(before[clave])} → ${comoTexto(after[clave])}`,
      sensible: false,
    });
  }

  const hayCredenciales = !!credenciales;
  const subject = hayCredenciales
    ? "Se han modificado credenciales de tu cuenta"
    : "Se ha modificado la configuración de tu cuenta";

  const preheader = `${lineas.length} cambio${lineas.length === 1 ? "" : "s"} el ${cuando}.`;

  const filas = lineas
    .map(
      (l) =>
        `<tr>
           <td style="padding:8px 12px 8px 0;vertical-align:top;white-space:nowrap;"><strong>${escapeHtml(l.etiqueta)}</strong></td>
           <td style="padding:8px 0;vertical-align:top;">${escapeHtml(l.detalle)}</td>
         </tr>`
    )
    .join("");

  const quien = ctx.autor
    ? `<p style="margin:0 0 12px;">Lo hizo: <strong>${escapeHtml(ctx.autor)}</strong>.</p>`
    : "";

  const avisoCredenciales = hayCredenciales
    ? `<p style="margin:16px 0 12px;padding:12px;background:#FFF8E1;border-left:3px solid #E6A700;">
         Por seguridad no incluimos el valor de ninguna credencial en este correo,
         ni siquiera parcialmente. Puedes comprobar su estado en Configuración.
       </p>`
    : "";

  const contacto = ctx.contacto
    ? `<p style="margin:0;">Si no reconoces este cambio, escríbenos a
         <a href="mailto:${escapeHtml(ctx.contacto)}" style="color:inherit;">${escapeHtml(ctx.contacto)}</a> cuanto antes.</p>`
    : `<p style="margin:0;">Si no reconoces este cambio, responde a este correo cuanto antes.</p>`;

  const bodyHtml = `
    ${quien}
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${filas}</table>
    ${avisoCredenciales}
    ${contacto}
  `;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: hayCredenciales ? "Credenciales modificadas" : "Configuración modificada",
    intro: `<p>Te avisamos de un cambio en la configuración de <strong>${escapeHtml(ctx.tenantName)}</strong>, realizado el ${escapeHtml(cuando)}.</p>`,
    blocks: [],
    bodyHtml,
    footer: "Recibes este aviso porque eres administrador de esta cuenta.",
  });

  const textLines = [
    `Cambio en la configuración de ${ctx.tenantName}`,
    `Fecha: ${cuando}`,
    ctx.autor ? `Lo hizo: ${ctx.autor}` : null,
    ``,
    ...lineas.map((l) => `- ${l.etiqueta}: ${l.detalle}`),
    ``,
    hayCredenciales
      ? `Por seguridad no incluimos el valor de ninguna credencial en este correo.`
      : null,
    ctx.contacto
      ? `Si no reconoces este cambio, escríbenos a ${ctx.contacto} cuanto antes.`
      : `Si no reconoces este cambio, responde a este correo cuanto antes.`,
  ].filter((l) => l !== null);

  return { subject, html, text: textLines.join("\n") };
}
