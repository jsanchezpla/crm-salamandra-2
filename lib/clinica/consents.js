/**
 * lib/clinica/consents.js — normalización de consentimientos RGPD del paciente
 * con TRAZA LEGAL.
 *
 * (Motivo del fichero nuevo en /lib, regla #2: Aumenta exige poder demostrar
 * quién otorgó/retiró cada consentimiento y cuándo. La forma canónica
 * { granted, at, by } y el sellado de fecha/usuario al cambiar se comparten
 * entre POST y PATCH de pacientes; centralizarlo evita divergencias en la traza.)
 *
 * Claves: images (toma de imágenes) · marketing (publicidad) · whatsapp
 * (comunicaciones por WhatsApp). Estructura persistida en patients.consents
 * (JSONB): { [key]: { granted: bool, at: ISO|null, by: userId|null } }.
 */

export const CONSENT_KEYS = ["images", "marketing", "whatsapp"];

export const CONSENT_LABELS = {
  images: "Toma de imágenes",
  marketing: "Publicidad",
  whatsapp: "Comunicaciones por WhatsApp",
};

function coerceGranted(v) {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object") return !!v.granted;
  return !!v;
}

function normalizeEntry(e) {
  if (!e || typeof e !== "object") return { granted: !!e, at: null, by: null };
  return { granted: !!e.granted, at: e.at ?? null, by: e.by ?? null };
}

/**
 * Fusiona `input` (parcial) sobre `previous`, sellando at/by SOLO en las claves
 * cuyo valor de `granted` cambia (o se establece por primera vez). Las claves no
 * presentes en `input` conservan su traza previa. Devuelve SIEMPRE las 3 claves.
 *
 * @param {object} input     lo que llega del body (puede traer bool u objeto).
 * @param {object} opts.previous  consents actuales del paciente (o {}).
 * @param {string} opts.userId    quién hace el cambio (para la traza).
 * @param {string} opts.now       ISO timestamp del cambio.
 */
export function normalizeConsents(input, { previous = {}, userId = null, now } = {}) {
  const prev = previous && typeof previous === "object" ? previous : {};
  const stamp = now ?? new Date().toISOString();
  const out = {};
  for (const key of CONSENT_KEYS) {
    const prevEntry = key in prev ? normalizeEntry(prev[key]) : null;
    if (input && typeof input === "object" && key in input) {
      const granted = coerceGranted(input[key]);
      if (!prevEntry || prevEntry.granted !== granted) {
        out[key] = { granted, at: stamp, by: userId };
      } else {
        out[key] = prevEntry;
      }
    } else {
      out[key] = prevEntry ?? { granted: false, at: null, by: null };
    }
  }
  return out;
}
