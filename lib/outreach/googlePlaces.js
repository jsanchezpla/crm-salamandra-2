/**
 * Cliente de la Google Places API (New) — Text Search.
 *
 * Es el "índice" del outreach: dado un sector + una ubicación, devuelve hasta
 * ~20 negocios con nombre, dirección, teléfono y web en UNA sola petición.
 * La clave es la del TENANT (BYOK, configurada en Configuración → IA), no una
 * global: cada cliente consume su propia cuota gratuita (1.000 peticiones/mes).
 *
 * IMPORTANTE (ToS de Google): estos datos se CONSULTAN, no se "compran". El
 * email NUNCA viene de aquí (Google no lo expone); se saca después visitando la
 * web del negocio (ver enrichWebsite.js). Lo que persistimos como lead nace de
 * esa consulta puntual + el enriquecimiento de la web propia de la empresa.
 *
 * Los errores llevan `code` para que el Route Handler los traduzca a un HTTP
 * claro (cuota agotada, clave inválida, etc.).
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const TIMEOUT_MS = 20_000;

// El FieldMask fija qué campos pedimos —y con ellos el tramo de precio. Teléfono
// y web son campos "Enterprise", pero entran en la cuota gratuita de 1.000/mes.
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
].join(",");

// Tope mensual de peticiones gestionado POR EL CRM (no por la cuota de Google):
// 999 = uno por debajo del cupo gratuito de 1.000/mes.
export const GOOGLE_MONTHLY_LIMIT = 999;

// "YYYY-MM" del mes en curso, clave del contador mensual.
export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Uso de Google del mes en curso a partir de OutreachSettings, aplicando el
 * reset mensual: si el contador guardado es de un mes anterior, cuenta como 0.
 * Devuelve { month, count, limit, remaining }.
 */
export function googleUsageOf(settings) {
  const month = currentMonth();
  const count = settings?.googlePlacesUsageMonth === month ? settings.googlePlacesUsageCount ?? 0 : 0;
  return { month, count, limit: GOOGLE_MONTHLY_LIMIT, remaining: Math.max(0, GOOGLE_MONTHLY_LIMIT - count) };
}

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Busca negocios en Google Places por sector + ubicación.
 * Devuelve un array de objetos con la forma de OutreachLead (sin email todavía).
 */
export async function searchGooglePlaces({ apiKey, sector, location, maxResults = 20 }) {
  if (!apiKey) throw err("Falta la clave de Google Places", "NO_KEY");
  const textQuery = [sector, location].filter(Boolean).join(" en ");
  if (!textQuery) throw err("Indica un sector o una ubicación", "BAD_QUERY");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "es",
        regionCode: "ES",
        pageSize: Math.min(Math.max(maxResults, 1), 20),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw err(e.name === "AbortError" ? "Google tardó demasiado en responder" : "No se pudo contactar con Google", "UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }

  // 429 = cuota agotada. 400/403 = clave inválida o Places API sin activar.
  if (res.status === 429) throw err("Cuota de Google agotada este mes", "QUOTA");
  if (res.status === 400 || res.status === 403) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message || "";
    } catch {
      /* sin cuerpo */
    }
    throw err(detail || "Clave de Google inválida o sin permisos", "BAD_KEY");
  }
  if (!res.ok) throw err(`Google respondió ${res.status}`, "ERROR");

  let data;
  try {
    data = await res.json();
  } catch {
    throw err("Google no devolvió JSON válido", "ERROR");
  }

  const places = Array.isArray(data.places) ? data.places : [];
  return places.map((p) => ({
    name: p.displayName?.text ?? null,
    sector: p.primaryTypeDisplayName?.text ?? sector ?? null,
    location: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    source: "google_maps",
    sourceUrl: p.googleMapsUri ?? null,
    email: null, // se rellena en la fase 2 (enrichWebsite)
    rawData: {
      via: "google_places",
      googleMapsUri: p.googleMapsUri ?? null,
      primaryType: p.primaryTypeDisplayName?.text ?? null,
    },
  }));
}
