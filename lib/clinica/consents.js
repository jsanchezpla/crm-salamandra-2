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
 * (JSONB): { [key]: { granted, at, by, evidencia } }.
 *
 * ── `evidencia`: la prueba de que se firmó (sprint 8, 02/08/2026) ───────────
 *
 * Un `granted: true` a secas no demuestra nada seis meses después. Cuando el
 * consentimiento se otorga DESDE EL PORTAL, `evidencia` guarda quién firmó, con
 * qué firma dibujada, desde qué IP y con qué navegador — el mismo conjunto que
 * da valor legal al contrato en `ContractSignature`.
 *
 *   evidencia: { firmaPath, guardianId, firmante, ip, userAgent, canal }
 *
 * Se conserva aunque luego se revoque: la revocación no borra que un día se
 * concedió, y la traza de ambas cosas es justo lo que hay que poder enseñar.
 *
 * ── Por qué `whatsapp` sigue aquí pero ya no se usa ────────────────────────
 *
 * Los CANALES por los que se escribe a la familia viven en el CLIENTE
 * (`clients.communication_prefs`, ver lib/clients/comunicaciones.js): quien
 * recibe los mensajes es la familia, y con dos hermanos en el centro el teléfono
 * es uno. La clave `whatsapp` de aquí es anterior a esa decisión (01/08/2026);
 * se mantiene para no romper fichas existentes, pero **la fuente de verdad para
 * escribir es el cliente**, no el paciente.
 */

export const CONSENT_KEYS = ["images", "marketing", "whatsapp"];

/** Los que se piden en el portal. `whatsapp` no: es cosa del cliente. */
export const CONSENT_KEYS_PORTAL = ["images"];

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
  if (!e || typeof e !== "object") return { granted: !!e, at: null, by: null, evidencia: null };
  return { granted: !!e.granted, at: e.at ?? null, by: e.by ?? null, evidencia: e.evidencia ?? null };
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
        // La evidencia previa NO se arrastra: pertenecía a la respuesta anterior.
        // Si alguien revoca lo firmado en el portal, la firma ya no prueba el
        // estado actual y dejarla ahí sería peor que no tenerla.
        out[key] = { granted, at: stamp, by: userId, evidencia: null };
      } else {
        out[key] = prevEntry;
      }
    } else {
      out[key] = prevEntry ?? { granted: false, at: null, by: null, evidencia: null };
    }
  }
  return out;
}

/**
 * ¿Ha CONTESTADO la familia a este consentimiento, o simplemente está a false
 * porque nunca se le preguntó?
 *
 * Es la diferencia que decide si el portal se lo enseña. Un `granted: false` sin
 * fecha significa «no lo sabemos»; con fecha significa «dijo que no», y a quien
 * ya dijo que no no se le vuelve a preguntar cada vez que entra.
 */
export function yaRespondido(consents, key) {
  const e = consents && typeof consents === "object" ? consents[key] : null;
  return !!(e && typeof e === "object" && e.at);
}

/**
 * Registra la respuesta al consentimiento de IMAGEN dada desde el portal,
 * con su traza. Devuelve el objeto `consents` completo listo para guardar.
 *
 * `granted` puede ser false: **decir que no es una respuesta válida** y se
 * guarda con su fecha. Un consentimiento que solo admite el «sí» no es un
 * consentimiento, y además guardar el «no» evita volver a preguntar en cada
 * visita.
 *
 * La firma dibujada solo se exige al ACEPTAR: no se firma una negativa, basta
 * con dejar constancia de quién dijo que no y cuándo.
 */
export function registrarImagenPortal(previous, { granted, firmaPath = null, guardianId = null, firmante = null, ip = null, userAgent = null, now } = {}) {
  const prev = previous && typeof previous === "object" ? previous : {};
  const salida = {};
  for (const key of CONSENT_KEYS) salida[key] = normalizeEntry(prev[key] ?? null);
  salida.images = {
    granted: !!granted,
    at: now ?? new Date().toISOString(),
    by: "portal",
    evidencia: {
      firmaPath: granted ? firmaPath : null,
      guardianId,
      firmante: firmante ? String(firmante).slice(0, 200) : null,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      canal: "portal",
    },
  };
  return salida;
}
