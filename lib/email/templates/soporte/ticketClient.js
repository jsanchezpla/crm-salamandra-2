import { renderLayout, escapeHtml } from "../layout.js";

/**
 * Email al CLIENTE FINAL del tenant sobre su ticket de soporte. Tres variantes
 * por `kind`:
 *   created  → "hemos recibido tu solicitud" (confirmación con nº y enlace)
 *   reply    → "tienes una nueva respuesta" (incluye el texto de la respuesta)
 *   resolved → "tu solicitud está resuelta" (con enlace por si quiere reabrir)
 *
 * `portalUrl` es el enlace de seguimiento con token: quien lo tenga ve el hilo
 * público de ESTE ticket. Por eso el propio email lo dice bajito en el footer.
 */
export function ticketClientTemplate({ tenantName, brand, kind, ticketRef, title, replyBody, portalUrl }) {
  const copy = {
    created: {
      subject: `${ticketRef} — Hemos recibido tu solicitud`,
      emailTitle: "Hemos recibido tu solicitud",
      intro: `<p style="margin:0;">Gracias por escribirnos. Tu solicitud ha quedado registrada con el número <strong>${escapeHtml(ticketRef)}</strong> y el equipo ya la tiene en su bandeja.</p>`,
    },
    reply: {
      subject: `${ticketRef} — Nueva respuesta a tu solicitud`,
      emailTitle: "Tienes una respuesta",
      intro: `<p style="margin:0;">Hay una respuesta nueva en tu solicitud <strong>${escapeHtml(ticketRef)}</strong>:</p>`,
    },
    resolved: {
      subject: `${ticketRef} — Tu solicitud está resuelta`,
      emailTitle: "Solicitud resuelta",
      intro: `<p style="margin:0;">Hemos marcado tu solicitud <strong>${escapeHtml(ticketRef)}</strong> como resuelta. Si sigue sin estar bien, responde desde el enlace y la reabrimos.</p>`,
    },
  }[kind] || {
    subject: `${ticketRef} — Actualización de tu solicitud`,
    emailTitle: "Actualización de tu solicitud",
    intro: `<p style="margin:0;">Hay novedades en tu solicitud <strong>${escapeHtml(ticketRef)}</strong>.</p>`,
  };

  const pieces = [];
  if (kind === "reply" && replyBody) {
    pieces.push(
      `<div style="border-left:3px solid ${brand?.primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(brand.primaryColor) ? brand.primaryColor : "#1B3A2D"};padding:10px 14px;background:#FAFAF8;border-radius:0 8px 8px 0;white-space:pre-wrap;">${escapeHtml(replyBody)}</div>`
    );
  }
  if (portalUrl) {
    pieces.push(
      `<p style="margin:18px 0 0;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#1B3A2D;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">Ver mi solicitud y responder</a></p>`
    );
  }

  const html = renderLayout({
    tenantName,
    brand,
    preheader: `${ticketRef} · ${title}`,
    title: copy.emailTitle,
    intro: copy.intro,
    blocks: [
      { label: "Nº", value: ticketRef },
      { label: "Asunto", value: title },
    ],
    bodyHtml: pieces.join(""),
    footer: `Este email fue enviado por ${tenantName}. El enlace de seguimiento es personal: no lo compartas.`,
  });

  const textLines = [
    copy.emailTitle,
    "",
    `Nº: ${ticketRef}`,
    `Asunto: ${title}`,
  ];
  if (kind === "reply" && replyBody) textLines.push("", "Respuesta:", replyBody);
  if (portalUrl) textLines.push("", `Ver y responder: ${portalUrl}`);
  textLines.push("", `— ${tenantName}`);

  return { subject: copy.subject, html, text: textLines.join("\n") };
}
