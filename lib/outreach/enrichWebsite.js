/**
 * Enriquecimiento de contacto (fase 2 del outreach).
 *
 * Google Places da nombre/dirección/teléfono/web, pero NUNCA email. Aquí se
 * visita la web pública del negocio y se extrae su correo del `mailto:` o del
 * texto de la home / la página de contacto. Es la fuente de email más limpia:
 * la publica la propia empresa para que la contacten.
 *
 * Defensivo por diseño: muchas webs no publican email, tienen anti-bot o dan
 * timeout. En ese caso se devuelve null y el lead se guarda sin email — no es
 * un error, es lo esperado (~40–70% de cobertura).
 */

const TIMEOUT_MS = 7000;
const MAX_HTML = 400_000; // no procesar páginas gigantes
const UA = "Mozilla/5.0 (compatible; SalamandraCRM/1.0; +https://salamandrasolutions.com)";

const EMAIL_G = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g; // barrido (global)
const EMAIL_ONE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i; // validación de uno

// Falsos positivos típicos de scraping de HTML (assets, placeholders, trackers).
const JUNK_RE =
  /(sentry\.|wixpress|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|@2x|@3x|example\.|tudominio|your-?email|youremail|email@example|nombre@|user@|domain\.com|@sentry|@example)/i;

// Buzones genéricos preferentes (mejor encaje legal que un email nominal).
const GENERIC_RE = /^(info|contacto|hola|contact|administracion|admin|comercial|ventas|clientes|atencion|citas|reservas)@/;

// Proveedores de correo gratuitos: un negocio pequeño puede usar su Gmail, así
// que se aceptan como respaldo. Cualquier OTRO dominio ajeno (proveedor del
// tema/plugin o tracker, p.ej. quadlayers.com) se descarta: NO es del negocio.
const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es",
  "live.com", "live.es", "yahoo.com", "yahoo.es", "icloud.com", "me.com",
  "protonmail.com", "proton.me", "terra.es", "telefonica.net", "movistar.es",
]);

// eTLD+1 aproximado (últimas 2 etiquetas). Vale para .com/.es; con dominios tipo
// .co.uk sería impreciso, aceptable para el mercado español objetivo.
function baseDomain(host) {
  const parts = (host || "").replace(/^www\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/html|text|xml/i.test(ct)) return null;
    const html = await res.text();
    return html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickEmail(html, domain) {
  if (!html) return null;
  const found = new Set();

  // mailto: primero — es el más fiable.
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    let e;
    try {
      e = decodeURIComponent(m[1]).trim().toLowerCase();
    } catch {
      e = m[1].trim().toLowerCase();
    }
    if (EMAIL_ONE.test(e) && !JUNK_RE.test(e)) found.add(e);
  }
  for (const m of html.matchAll(EMAIL_G)) {
    const e = m[0].trim().toLowerCase();
    if (!JUNK_RE.test(e)) found.add(e);
  }

  if (found.size === 0) return null;
  const arr = [...found];
  const siteBase = baseDomain(domain);
  const domainOf = (e) => e.split("@")[1] ?? "";

  // Un email es DEL NEGOCIO solo si es de SU dominio o de un proveedor gratuito.
  // Cualquier otro dominio ajeno (tema/plugin/tracker) se descarta: antes se
  // colaba p.ej. hello@quadlayers.com. Mejor devolver null que un email erróneo.
  const sameDomain = arr.filter((e) => baseDomain(domainOf(e)) === siteBase);
  const freeMail = arr.filter((e) => FREE_PROVIDERS.has(domainOf(e)));
  const generic = (list) => list.find((e) => GENERIC_RE.test(e));

  // Preferencia: genérico del dominio → cualquiera del dominio → genérico
  // gratuito → cualquiera gratuito → null (nunca un dominio ajeno).
  return generic(sameDomain) || sameDomain[0] || generic(freeMail) || freeMail[0] || null;
}

/**
 * Devuelve el mejor email encontrado en la web del negocio, o null.
 * Máximo 2 peticiones: home + una página de contacto de respaldo.
 */
export async function extractEmailFromWebsite(website) {
  if (!website) return null;
  let url;
  try {
    url = new URL(website.startsWith("http") ? website : `https://${website}`);
  } catch {
    return null;
  }
  const domain = url.hostname.replace(/^www\./, "");

  const home = await fetchText(url.href);
  const email = pickEmail(home, domain);
  if (email) return email;

  // Respaldo: una única página de contacto típica.
  const contact = await fetchText(new URL("/contacto", url.origin).href);
  return pickEmail(contact, domain);
}
