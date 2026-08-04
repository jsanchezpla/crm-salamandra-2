/**
 * menuEmail — email al paciente con su pauta nutricional en PDF adjunto
 * (POST /api/nutricion/plans/[id]/send-email, Sprint Nutrición 8.3).
 *
 * El PDF va como adjunto porque el paciente no tiene acceso al dashboard del
 * CRM (un enlace autenticado no le serviría). El copy sigue la convención del
 * layout: tuteo, neutro pero cálido.
 *
 * ⚠️ Esto lo lee la PACIENTE, no la nutricionista. Desde el 04/08/2026 se
 * llama PAUTA (Rodrigo): el `planName` del parámetro es el nombre de la fila
 * en `plans`, que no ha cambiado.
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
  const subject = `Tu pauta nutricional — ${tenantName}`;
  const hello = clientName ? `Hola ${escapeHtml(clientName)},` : "Hola,";

  const html = renderLayout({
    tenantName,
    brand,
    preheader: `Tu pauta "${planName}" en PDF adjunto`,
    title: "Tu pauta nutricional",
    intro: `
      <p style="margin:0 0 12px;">${hello}</p>
      <p style="margin:0 0 12px;">
        Te adjuntamos en PDF tu pauta nutricional
        <strong>${escapeHtml(planName)}</strong> con las comidas, las opciones y
        las cantidades.
      </p>
      <p style="margin:0;">
        Si tienes cualquier duda sobre la pauta, responde a este email y te
        ayudamos.
      </p>`,
    blocks: [{ label: "Pauta", value: planName }],
    footer: `Este email fue enviado por ${tenantName}. La pauta adjunta es personal e intransferible.`,
  });

  const text =
    `${clientName ? `Hola ${clientName},` : "Hola,"}\n\n` +
    `Te adjuntamos en PDF tu pauta nutricional "${planName}" con las comidas, ` +
    `las opciones y las cantidades.\n\n` +
    `Si tienes cualquier duda, responde a este email.\n\n— ${tenantName}`;

  return { subject, html, text };
}
