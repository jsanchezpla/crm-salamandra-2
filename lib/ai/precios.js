/**
 * lib/ai/precios.js — lo que cuesta cada token, para ESTIMAR el gasto de la IA
 * (11/09/2026).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Aumenta se quedó sin saldo de Anthropic a los diez días de cargar la cuenta y
 * nadie sabía cuánto costaba cada llamada: el CRM leía la respuesta del modelo
 * y tiraba el bloque `usage` que viene con ella. Este fichero pone precio a
 * ese bloque para que `lib/ai/usoDeIA.js` guarde, con cada llamada, cuánto ha
 * costado aproximadamente.
 *
 * Son los precios PÚBLICOS de Anthropic (platform.claude.com → Pricing) y de
 * OpenAI, en dólares por millón de tokens. Es una estimación, no la factura:
 * la cifra oficial la da la consola de cada proveedor. Si Anthropic cambia
 * precios, se cambia aquí y ya; las filas ya guardadas conservan el coste con
 * el que se calcularon.
 *
 * `escritura1h` es la escritura de caché a una hora, que es la que usa el CRM
 * (`lib/outreach/analysis/anthropic.js`): cuesta el doble que una entrada
 * normal. `lectura` es el acierto de caché: la décima parte.
 *
 * Puro: sin base, sin red.
 */

/** Dólares por millón de tokens. */
export const PRECIOS_ANTHROPIC = Object.freeze({
  "claude-haiku-4-5-20251001": Object.freeze({ entrada: 1, escritura1h: 2, lectura: 0.1, salida: 5 }),
  "claude-sonnet-5": Object.freeze({ entrada: 2, escritura1h: 4, lectura: 0.2, salida: 10 }),
  "claude-opus-4-8": Object.freeze({ entrada: 5, escritura1h: 10, lectura: 0.5, salida: 25 }),
});

/**
 * Los modelos de OpenAI con los que se puede REDACTAR (12/09/2026; catálogo en
 * `lib/ai/openaiModel.js`). `lectura` es la entrada cacheada, que OpenAI cobra
 * a la décima parte sin que haya que pedirlo; no hay precio de escritura de
 * caché porque OpenAI no la cobra.
 */
export const PRECIOS_OPENAI = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ entrada: 0.2, lectura: 0.02, salida: 1.2 }),
  "gpt-5.6-terra": Object.freeze({ entrada: 2, lectura: 0.2, salida: 12 }),
  "gpt-5.6-sol": Object.freeze({ entrada: 4, lectura: 0.4, salida: 20 }),
});

/** Whisper (whisper-1) de OpenAI: dólares por MINUTO de audio. */
export const PRECIO_WHISPER_POR_MINUTO = 0.006;

/**
 * Los cuatro contadores del `usage` de Anthropic, siempre como números.
 * El SDK los llama `input_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens` y `output_tokens`; aquí se traducen y se limpian.
 */
export function desgloseDeUsage(usage) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  return {
    entrada: n(usage?.input_tokens),
    escritura: n(usage?.cache_creation_input_tokens),
    lectura: n(usage?.cache_read_input_tokens),
    salida: n(usage?.output_tokens),
  };
}

/**
 * Coste estimado en dólares de una llamada a Anthropic, o `null` si el modelo
 * no está en la tabla (se guarda igual, sin precio, para no perder la fila).
 */
export function costeAnthropicUsd(modelo, usage) {
  const p = PRECIOS_ANTHROPIC[modelo];
  if (!p) return null;
  const d = desgloseDeUsage(usage);
  const usd =
    (d.entrada * p.entrada + d.escritura * p.escritura1h + d.lectura * p.lectura + d.salida * p.salida) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Coste estimado en dólares de una llamada de TEXTO a OpenAI (el `usage` ya
 * traducido a los contadores de Anthropic por `lib/ai/openai.js`), o `null`
 * si el modelo no está en la tabla.
 */
export function costeOpenAIUsd(modelo, usage) {
  const p = PRECIOS_OPENAI[modelo];
  if (!p) return null;
  const d = desgloseDeUsage(usage);
  const usd = (d.entrada * p.entrada + d.lectura * p.lectura + d.salida * p.salida) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Coste estimado en dólares de transcribir `segundos` de audio con Whisper. */
export function costeWhisperUsd(segundos) {
  const s = Number(segundos);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.round((s / 60) * PRECIO_WHISPER_POR_MINUTO * 1_000_000) / 1_000_000;
}
