import { renderLayout, escapeHtml } from "../layout.js";

/**
 * Email INTERNO al equipo del tenant sobre un ticket. `kind`:
 *   new_portal   → ha entrado un ticket por el portal público
 *   assigned     → te han asignado un ticket
 *   client_reply → el cliente ha respondido en un ticket
 *
 * `preview` va recortado (200 chars): el sitio del contenido completo es el
 * CRM, no la bandeja de correo.
 */
export function ticketTeamTemplate({ tenantName, brand, kind, ticketRef, title, requester, preview, dashboardUrl }) {
  const copy = {
    new_portal: {
      subject: `${ticketRef} — Nuevo ticket desde el portal`,
      emailTitle: "Nuevo ticket de soporte",
      intro: `<p style="margin:0;"><strong>${escapeHtml(requester || "Alguien")}</strong> ha abierto una solicitud desde el portal.</p>`,
    },
    assigned: {
      subject: `${ticketRef} — Ticket asignado a ti`,
      emailTitle: "Te han asignado un ticket",
      intro: `<p style="margin:0;">Tienes un ticket nuevo a tu nombre. Entra al CRM para verlo y responder.</p>`,
    },
    client_reply: {
      subject: `${ticketRef} — El cliente ha respondido`,
      emailTitle: "Respuesta del cliente",
      intro: `<p style="margin:0;"><strong>${escapeHtml(requester || "El cliente")}</strong> ha respondido en el ticket.</p>`,
    },
  }[kind] || {
    subject: `${ticketRef} — Actividad en el ticket`,
    emailTitle: "Actividad en un ticket",
    intro: `<p style="margin:0;">Hay novedades en un ticket de soporte.</p>`,
  };

  const pieces = [];
  if (preview) {
    pieces.push(
      `<div style="border:1px solid #E5E7EB;padding:10px 14px;border-radius:8px;color:#374151;white-space:pre-wrap;">${escapeHtml(String(preview).slice(0, 200))}${String(preview).length > 200 ? "…" : ""}</div>`
    );
  }
  if (dashboardUrl) {
    pieces.push(
      `<p style="margin:18px 0 0;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#1B3A2D;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">Abrir en el CRM</a></p>`
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
    footer: `Aviso interno del CRM de ${tenantName}.`,
  });

  const textLines = [copy.emailTitle, "", `Nº: ${ticketRef}`, `Asunto: ${title}`];
  if (preview) textLines.push("", String(preview).slice(0, 200));
  if (dashboardUrl) textLines.push("", `Abrir en el CRM: ${dashboardUrl}`);
  textLines.push("", `— CRM ${tenantName}`);

  return { subject: copy.subject, html, text: textLines.join("\n") };
}
