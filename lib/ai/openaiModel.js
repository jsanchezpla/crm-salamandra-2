/**
 * lib/ai/openaiModel.js — modelo de OpenAI (ChatGPT) por tenant, para
 * REDACTAR: el hermano de `anthropicModel.js` (12/09/2026).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Dos clientes pidieron hacer con ChatGPT lo mismo que el CRM hace con Claude
 * —registros de sesión, informes, actas, correos— con su propia clave de
 * OpenAI. Hasta hoy esa clave solo servía para Whisper (voz → texto). Desde
 * hoy el tenant elige PROVEEDOR en Configuración → Conexiones
 * (`lib/ai/proveedorIa.js`), y si elige OpenAI, este es el modelo con el que
 * redacta. Se guarda SIN cifrar (no es un secreto) en
 * `settings.integrations.openaiModel`.
 *
 * ── TRES MODELOS, EN LA MISMA ESCALERA QUE LOS DE CLAUDE ───────────────────
 * Económico por defecto, matiz y máxima calidad. Luna cuesta la quinta parte
 * que Haiku a la entrada y la cuarta a la salida; Terra se parece a Sonnet;
 * Sol a Opus. Los precios viven en `lib/ai/precios.js`.
 *
 * Los IDs cambian con el tiempo: verificar contra el catálogo de OpenAI
 * (developers.openai.com → Models) antes de añadir uno, y apuntar en
 * `esfuerzo` cómo se le apaga el razonamiento a ese modelo. La familia GPT-5.6
 * admite `reasoning_effort: "none"`; un modelo que no lo admita devolvería un
 * 400 al primer intento, así que no se da por hecho: se mira.
 */
export const OPENAI_MODELS = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Recomendado · el más rápido y económico", esfuerzo: "none" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Más matiz al redactar · unas 10 veces más caro que Luna", esfuerzo: "none" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Máxima calidad · unas 20 veces más caro que Luna", esfuerzo: "none" },
];

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

export function isAllowedOpenAIModel(id) {
  return typeof id === "string" && OPENAI_MODELS.some((m) => m.id === id);
}

/** Modelo de OpenAI efectivo del tenant: el configurado si es válido, o Luna. */
export function getTenantOpenAIModel(ctx) {
  const m = ctx?.tenant?.settings?.integrations?.openaiModel;
  return isAllowedOpenAIModel(m) ? m : DEFAULT_OPENAI_MODEL;
}

/**
 * Lo que se añade a la petición para que el modelo NO razone antes de
 * escribir: la misma decisión que `parametrosDeRazonamiento` en Claude
 * (11/09/2026) y por el mismo motivo —ninguno de los sitios que llaman a la IA
 * fue diseñado contando con razonamiento previo, y en OpenAI los tokens de
 * razonamiento se cobran como salida aunque no se vean—. Vacío si el modelo
 * no está en la lista: mejor no mandar un parámetro que no se sabe si admite.
 */
export function parametrosDeRazonamientoOpenAI(model) {
  const m = OPENAI_MODELS.find((x) => x.id === model);
  return m?.esfuerzo ? { reasoning_effort: m.esfuerzo } : {};
}
