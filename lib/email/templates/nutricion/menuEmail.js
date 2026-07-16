/**
 * menuEmail — email al paciente con su plan nutricional en PDF adjunto
 * (POST /api/nutricion/plans/[id]/send-email, Sprint Nutrición 8.3).
 *
 * El PDF va como adjunto porque el paciente no tiene acceso al dashboard del
 * CRM (un enlace autenticado no le serviría). El copy sigue la convención del
 * layout: tuteo, neutro pero cálido.
 */

import { renderLayout } from "../layout.js";

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {{ tenantName: string, brand?: object, clientName?: string, planName: string }} params
 * @returns {{ subject: string, html: string, text: string }}
 */
export function menuEmail({ tenantName, brand, clientName, planName }) {
  const subject = `Tu plan nutricional — ${tenantName}`;
  const hello = clientName ? `Hola ${escapeHtml(clientName)},` : "Hola,";

  const html = renderLayout({
    tenantName,
    brand,
    preheader: `Tu plan "${planName}" en PDF adjunto`,
    title: "Tu plan nutricional",
    intro: `
      <p style="margin:0 0 12px;">${hello}</p>
      <p style="margin:0 0 12px;">
        Te adjuntamos en PDF tu plan nutricional
        <strong>${escapeHtml(planName)}</strong> con las comidas, opciones y
        cantidades pautadas.
      </p>
      <p style="margin:0;">
        Si tienes cualquier duda sobre el plan, responde a este email y te
        ayudamos.
      </p>`,
    blocks: [{ label: "Plan", value: planName }],
    footer: `Este email fue enviado por ${tenantName}. El plan adjunto es personal e intransferible.`,
  });

  const text =
    `${clientName ? `Hola ${clientName},` : "Hola,"}\n\n` +
    `Te adjuntamos en PDF tu plan nutricional "${planName}" con las comidas, ` +
    `opciones y cantidades pautadas.\n\n` +
    `Si tienes cualquier duda, responde a este email.\n\n— ${tenantName}`;

  return { subject, html, text };
}
