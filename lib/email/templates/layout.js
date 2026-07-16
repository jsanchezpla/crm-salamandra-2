/**
 * Layout base reutilizable para emails transaccionales del CRM.
 *
 * Toma branding desde `Tenant.settings.brand` (primaryColor, secondaryColor,
 * accent, card, logoUrl). Si faltan, usa los defaults Salamandra (#1B3A2D).
 *
 * El layout es tabla-based (compat con Outlook clásico) y devuelve un
 * HTML completo. Para clientes que prefieren texto plano, los templates
 * proveen `text` aparte.
 *
 * Convención de copy: tuteo en español, neutro pero cálido. Los strings
 * concretos viven en cada template (este layout es solo estructura).
 */

const DEFAULT_BRAND = {
  primaryColor: "#1B3A2D",
  secondaryColor: "#0F0F0F",
  accent: "#F7F1EB",
  card: "#FFFFFF",
  text: "#1F2937",
  muted: "#6B7280",
};

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Los colores de marca (Tenant.settings.brand) se interpolan CRUDOS dentro de
// atributos style="…" del HTML del email, y el endpoint de settings los guarda
// como string arbitrario sin validar. Sin esto, un admin podría inyectar HTML
// (p. ej. un enlace de phishing) que llega al paciente desde el dominio
// verificado del CRM. Solo aceptamos tokens de color inequívocos (hex, rgb()/
// rgba() o una palabra clave), y si no, caemos al color por defecto.
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_RE = /^rgba?\(\s*[\d.,\s%]+\)$/i;
const NAME_RE = /^[a-zA-Z]{3,20}$/;
function safeColor(v, fallback) {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return HEX_RE.test(t) || RGB_RE.test(t) || NAME_RE.test(t) ? t : fallback;
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   preheader?: string,        // texto invisible que aparece como preview en el inbox
 *   title: string,             // título principal (font-display)
 *   intro: string,             // párrafo introductorio (acepta HTML escapado)
 *   blocks?: Array<{label: string, value: string}>,  // datos clave en formato label/value
 *   bodyHtml?: string,         // contenido libre extra después de los bloques
 *   footer?: string,           // copy del footer (legal o despedida)
 * }} params
 * @returns {string} HTML completo del email
 */
export function renderLayout(params) {
  const raw = { ...DEFAULT_BRAND, ...(params.brand || {}) };
  // Sanear cada color antes de interpolarlo en los style="…" (anti-inyección).
  const brand = {
    primaryColor: safeColor(raw.primaryColor, DEFAULT_BRAND.primaryColor),
    secondaryColor: safeColor(raw.secondaryColor, DEFAULT_BRAND.secondaryColor),
    accent: safeColor(raw.accent, DEFAULT_BRAND.accent),
    card: safeColor(raw.card, DEFAULT_BRAND.card),
    text: safeColor(raw.text, DEFAULT_BRAND.text),
    muted: safeColor(raw.muted, DEFAULT_BRAND.muted),
  };
  const tenantName = escapeHtml(params.tenantName);
  const title = escapeHtml(params.title);
  const intro = params.intro || "";
  const preheader = escapeHtml(params.preheader || "");
  const blocks = params.blocks || [];
  const bodyHtml = params.bodyHtml || "";
  const footer = params.footer
    ? escapeHtml(params.footer)
    : `Este email fue enviado por ${tenantName}.`;

  const blocksHtml = blocks
    .filter((b) => b && b.value)
    .map(
      (b) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${brand.muted};letter-spacing:.04em;text-transform:uppercase;width:120px;">${escapeHtml(b.label)}</td>
          <td style="padding:6px 0;font-size:15px;color:${brand.text};font-weight:500;">${escapeHtml(b.value)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${brand.accent};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.text};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${brand.accent};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${brand.card};border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
        <tr>
          <td style="height:6px;background:${brand.primaryColor};"></td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px;">
            <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:${brand.muted};margin-bottom:8px;">${tenantName}</div>
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:${brand.text};font-weight:600;">${title}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 8px;font-size:15px;line-height:1.55;color:${brand.text};">
            ${intro}
          </td>
        </tr>
        ${
          blocks.length > 0
            ? `<tr><td style="padding:16px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${brand.accent};border-radius:10px;padding:18px 20px;">
                <tbody>${blocksHtml}</tbody>
               </table></td></tr>`
            : ""
        }
        ${bodyHtml ? `<tr><td style="padding:8px 32px 20px;font-size:14px;line-height:1.55;color:${brand.text};">${bodyHtml}</td></tr>` : ""}
        <tr>
          <td style="padding:18px 32px 28px;border-top:1px solid ${brand.accent};font-size:12px;color:${brand.muted};line-height:1.5;">
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export { escapeHtml };
