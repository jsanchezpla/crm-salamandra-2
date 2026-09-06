import { randomUUID } from "node:crypto";
import { complete } from "../outreach/analysis/anthropic.js";
import { normalizarBloques, TIPOS } from "./bloques.js";

/**
 * lib/mailing/ia.js — redactar una campaña con IA (sprint 2, 06/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón que `lib/support/ai.js` y
 * el análisis de Captación —proveedor compartido `complete()`, clave BYOK del
 * tenant, pedir SOLO JSON, parsear defensivo— y la misma pareja real/simulado
 * para la demo pública.)
 *
 * ── LA IA RELLENA BLOQUES, NUNCA ESCRIBE HTML (plan, decisión 1.3) ──────────
 * Se le pide un JSON con asunto, preheader y una lista de bloques del catálogo
 * de `lib/mailing/bloques.js`. Lo que devuelve pasa por `normalizarBloques`,
 * que es la misma lista blanca por la que pasa lo que escribe una persona: un
 * `<script>`, una etiqueta rara o un bloque inventado no llegan al correo.
 *
 * ── LO QUE TIENE PROHIBIDO ──────────────────────────────────────────────────
 * Inventar. Fechas, precios, direcciones, nombres de personas, URL o «casos de
 * éxito» que no estén en la instrucción del usuario. Es la lección de la IA de
 * Captación (se inventaba clientes): el prompt lo dice con todas las letras y,
 * si falta un dato, la IA deja un hueco entre corchetes para que lo rellene
 * quien envía. Un botón solo si la instrucción trae un enlace.
 */

const TONOS = { cercano: "cercano y natural", profesional: "profesional y claro", entusiasta: "entusiasta pero sin exagerar" };

function stripFences(s) {
  return String(s ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/** El system prompt: quién escribe, para quién, y las reglas. PURO. */
export function promptRedaccion({ centro, vocab, tono = "cercano", conImagen = false }) {
  const plural = vocab?.plural?.toLowerCase() ?? "clientes";
  return [
    `Redactas correos de novedades (newsletters) para «${centro?.nombre || "un centro"}», que escribe a sus ${plural} que han aceptado recibir novedades. Escribes en español de España, tuteando, con un tono ${TONOS[tono] ?? TONOS.cercano}. Frases cortas, sin exclamaciones en cadena, sin emojis, sin mayúsculas para gritar.`,
    "",
    "Devuelves SOLO un JSON válido, sin texto antes ni después, con esta forma exacta:",
    `{"asunto":"…","preheader":"…","bloques":[{"tipo":"titulo","texto":"…","nivel":1},{"tipo":"texto","html":"<p>…</p>"},{"tipo":"boton","texto":"…","url":"…"},{"tipo":"imagen"},{"tipo":"separador"}]}`,
    "",
    "Reglas de los bloques:",
    `- Tipos permitidos: ${TIPOS.filter((t) => t !== "firma").join(", ")}. Nada más.`,
    "- Un título al principio (nivel 1, máximo 60 caracteres). Entre uno y tres bloques de texto de 40 a 90 palabras cada uno, en <p>. En el html SOLO se admiten <p>, <strong>, <em>, <a href>, <ul>, <ol>, <li> y <br>.",
    "- Un botón SOLO si la instrucción incluye un enlace (una URL): usa esa URL tal cual. Si no hay enlace, no pongas botón.",
    conImagen
      ? '- Hay una imagen destacada: incluye UN bloque {"tipo":"imagen"} justo después del título (sin url, la pone el sistema), y un "alt" breve que la describa según la instrucción.'
      : "- No pongas bloques de imagen.",
    "- Puedes usar {{nombre}} en el título o en el texto para que salga el nombre de cada persona (como mucho una vez).",
    "- El asunto: máximo 60 caracteres, concreto, sin mayúsculas gritonas ni «¡¡». El preheader: una frase de hasta 90 caracteres que complemente al asunto, no lo repita.",
    "",
    "PROHIBIDO inventar: no añadas fechas, horas, precios, direcciones, teléfonos, nombres de personas, testimonios, cifras ni enlaces que no estén en la instrucción. Si un dato hace falta y no está, escribe un hueco entre corchetes, por ejemplo [fecha] o [precio], para que lo rellene quien envía. No prometas nada que la instrucción no diga.",
  ].join("\n");
}

/** Lo que se le pide esta vez. PURO. */
export function mensajeRedaccion({ instruccion, bloquesActuales = [], imagenUrl = null }) {
  const partes = [`Instrucción de quien envía:\n${String(instruccion ?? "").trim()}`];
  if (imagenUrl) partes.push("Hay una imagen destacada subida por el usuario (el sistema pondrá su URL).");
  const textoActual = (bloquesActuales ?? [])
    .map((b) => (b.tipo === "titulo" ? b.texto : b.tipo === "texto" ? String(b.html ?? "").replace(/<[^>]+>/g, " ") : ""))
    .filter((t) => t && t.trim())
    .join("\n")
    .slice(0, 3000);
  if (textoActual.trim()) partes.push(`Borrador actual del usuario (por si sirve de contexto; puedes mejorarlo, no tienes que respetarlo):\n${textoActual}`);
  return partes.join("\n\n");
}

/**
 * De la respuesta cruda a una propuesta usable: JSON parseado, bloques por la
 * lista blanca, imagen destacada colocada, tamaños acotados. `null` si no hay
 * nada aprovechable. PURO.
 */
export function parsearPropuesta(texto, { imagenUrl = null } = {}) {
  let json;
  try {
    json = JSON.parse(stripFences(texto));
  } catch {
    // A veces mete una frase antes: se rescata el primer objeto JSON.
    const m = String(texto ?? "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      json = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!json || typeof json !== "object") return null;
  const crudos = Array.isArray(json.bloques) ? json.bloques : [];
  const conIds = crudos
    .filter((b) => b && typeof b === "object" && b.tipo !== "firma")
    .map((b) => {
      const base = { ...b, id: randomUUID() };
      if (b.tipo === "imagen") return { ...base, url: imagenUrl || "", alt: b.alt ?? "", enlace: "", ancho: "completa" };
      if (b.tipo === "titulo") return { ...base, nivel: Number(b.nivel) === 2 ? 2 : 1, alineacion: b.alineacion ?? "izquierda" };
      if (b.tipo === "boton") return { ...base, alineacion: b.alineacion ?? "centro" };
      return base;
    })
    // Sin imagen destacada, un bloque de imagen vacío no pinta nada.
    .filter((b) => b.tipo !== "imagen" || b.url);
  const bloques = normalizarBloques(conIds);
  const asunto = String(json.asunto ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const preheader = String(json.preheader ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!asunto && !bloques.length) return null;
  return { asunto, preheader, bloques };
}

/** Llama a Claude y devuelve la propuesta (o null si no se entendió la respuesta). */
export async function redactarConIa({ centro, vocab, instruccion, tono, imagenUrl = null, bloquesActuales = [], apiKey, model }) {
  const raw = await complete({
    system: promptRedaccion({ centro, vocab, tono, conImagen: !!imagenUrl }),
    user: mensajeRedaccion({ instruccion, bloquesActuales, imagenUrl }),
    model,
    maxTokens: 2000,
    apiKey,
  });
  return parsearPropuesta(raw, { imagenUrl });
}

/** Tres asuntos alternativos para el A/B. Devuelve [] si no se entendió. */
export async function asuntosAlternativos({ centro, asunto, bloques = [], apiKey, model }) {
  const contenido = mensajeRedaccion({ instruccion: `Asunto actual: ${asunto}`, bloquesActuales: bloques });
  const raw = await complete({
    system: `Propones asuntos de correo para las novedades de «${centro?.nombre || "un centro"}», en español de España, tuteando. Devuelves SOLO un JSON: {"asuntos":["…","…","…"]} con tres asuntos distintos entre sí y distintos del actual, de menos de 60 caracteres, concretos, sin mayúsculas gritonas, sin emojis y sin inventar datos que no estén en el contenido.`,
    user: contenido,
    model,
    maxTokens: 400,
    apiKey,
  });
  try {
    const j = JSON.parse(stripFences(raw));
    return (Array.isArray(j?.asuntos) ? j.asuntos : []).map((a) => String(a).trim().slice(0, 200)).filter(Boolean).slice(0, 3);
  } catch {
    return [];
  }
}

// ── Simulado (demo pública: sin API real ni coste) ──────────────────────────

export function fakeRedaccion({ instruccion, imagenUrl = null }) {
  const tema = String(instruccion ?? "").trim().slice(0, 80) || "novedades del centro";
  const bloques = [
    { id: randomUUID(), tipo: "titulo", texto: "Hola {{nombre}}, tenemos novedades", nivel: 1, alineacion: "izquierda" },
    ...(imagenUrl ? [{ id: randomUUID(), tipo: "imagen", url: imagenUrl, alt: "Imagen destacada", enlace: "", ancho: "completa" }] : []),
    { id: randomUUID(), tipo: "texto", html: `<p>Te escribimos por esto: <strong>${tema.replace(/[<>&]/g, "")}</strong>. Aquí iría un párrafo redactado a partir de tu instrucción, sin inventar fechas ni precios: donde falte un dato, verías un hueco como [fecha] para rellenarlo.</p>` },
    { id: randomUUID(), tipo: "texto", html: "<p>En la demo la IA no gasta tokens: este texto es de ejemplo. Con tu clave de Anthropic puesta en Configuración, aquí saldría el correo de verdad.</p>" },
  ];
  return { asunto: `Novedades: ${tema}`.slice(0, 60), preheader: "Un resumen rápido de lo que viene", bloques: normalizarBloques(bloques) };
}

export function fakeAsuntos({ asunto }) {
  const base = String(asunto ?? "Novedades").slice(0, 40);
  return [`${base} (esta semana)`, `¿Te lo cuento? ${base}`.slice(0, 60), `${base}: lo que necesitas saber`.slice(0, 60)];
}
