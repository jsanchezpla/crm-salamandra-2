import { createHmac } from "crypto";

/**
 * Integración con n8n para el scraping de empresas ("Buscar nuevos").
 *
 * n8n hace el trabajo sucio (Páginas Amarillas, Google Maps, LinkedIn) y
 * devuelve las empresas al CRM en la misma respuesta. Nunca se llama por
 * defecto: solo cuando el usuario lo pide explícitamente, porque cuesta tiempo.
 *
 * Autenticación: el webhook del Outreach original iba SIN autenticar. Aquí se
 * firma el cuerpo con HMAC-SHA256 (misma convención que lib/training/webhookAuth.js)
 * para que el flujo de n8n pueda rechazar peticiones que no vengan del CRM.
 * Si no hay secreto configurado no se firma, pero se avisa por stderr.
 */

const TIMEOUT_MS = 120_000;

/**
 * Normaliza una empresa cruda a los campos de `outreach_leads`.
 * Defensivo con los nombres de campo: el flujo de n8n puede cambiar y no
 * queremos que un rename allí rompa la ingesta. Lo no mapeado va a `rawData`.
 */
export function normalizeCompany(item, defaultSource) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = item?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  return {
    name: pick("name", "nombre", "title"),
    sector: pick("sector"),
    location: pick("location", "ubicacion", "direccion", "address"),
    website: pick("website", "web", "url"),
    phone: pick("phone", "telefono"),
    email: pick("email"),
    source: pick("source", "fuente") || defaultSource || "manual",
    sourceUrl: pick("sourceUrl", "fuente_url", "source_url"),
    rawData: item?.rawData ?? item?.raw_data ?? item ?? {},
  };
}

function signBody(rawBody) {
  const secret = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) {
    process.stderr.write(
      "[outreach:scraping] OUTREACH_WEBHOOK_SECRET no configurado: la petición a n8n va SIN firmar\n"
    );
    return null;
  }
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Llama al webhook de scraping y devuelve las empresas normalizadas.
 * Lanza un error con `code` para que el Route Handler traduzca a un HTTP claro.
 */
export async function callScrapingWebhook({ sector, location, sources }) {
  const url = process.env.OUTREACH_SCRAPING_WEBHOOK_URL;
  if (!url) {
    const err = new Error("OUTREACH_SCRAPING_WEBHOOK_URL no está configurada");
    err.code = "NO_WEBHOOK";
    throw err;
  }

  const rawBody = JSON.stringify({ sector, location, sources });
  const signature = signBody(rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "x-outreach-signature": signature } : {}),
      },
      body: rawBody,
      signal: controller.signal,
    });
  } catch (err) {
    const e = new Error(err.name === "AbortError" ? "El scraping ha tardado demasiado" : "No se pudo contactar con n8n");
    e.code = "WEBHOOK_UNREACHABLE";
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = new Error(`n8n respondió ${res.status}`);
    err.code = "WEBHOOK_ERROR";
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error("n8n no devolvió JSON válido");
    err.code = "WEBHOOK_ERROR";
    throw err;
  }

  // Se acepta un array directo o un objeto que lo envuelva.
  const raw = Array.isArray(data) ? data : data.empresas || data.companies || data.results || [];
  if (!Array.isArray(raw)) {
    const err = new Error("n8n no devolvió una lista de empresas");
    err.code = "WEBHOOK_ERROR";
    throw err;
  }

  return raw.map((item) => normalizeCompany(item, sources?.[0]));
}
