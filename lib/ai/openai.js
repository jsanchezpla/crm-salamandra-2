/**
 * lib/ai/openai.js — el cliente de OpenAI (ChatGPT) para REDACTAR (12/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los dos envoltorios de la IA
 * de texto —`lib/outreach/analysis/anthropic.js` y `lib/assistant/anthropic.js`—
 * que desde hoy despachan por proveedor.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Dos clientes quieren hacer con ChatGPT lo que el CRM hace con Claude, con
 * su propia clave de OpenAI (BYOK, como todo lo demás). Este fichero habla con
 * la API de OpenAI y devuelve EXACTAMENTE lo mismo que devuelve el cliente de
 * Anthropic —`{ texto, parada }`, con `parada` en el vocabulario de Anthropic—
 * para que los veinte sitios que ya leen esa respuesta no se enteren de quién
 * la escribió. Quien pide un registro clínico sigue mirando
 * `parada === "max_tokens"` para saber que se quedó corto, y sigue valiendo.
 *
 * ── SIN SDK, COMO WHISPER ──────────────────────────────────────────────────
 * Usa la REST API con `fetch`, igual que `lib/clinica/whisper.js`: no se añade
 * la dependencia de OpenAI por dos llamadas. Va a Chat Completions, que es la
 * API que admiten todos los modelos del catálogo y la que más tiempo lleva
 * estable; `max_completion_tokens` y no `max_tokens`, porque los modelos que
 * razonan rechazan el nombre viejo.
 *
 * ── LO QUE SE CONSERVA DEL CLIENTE DE ANTHROPIC ────────────────────────────
 *   · Sin razonamiento previo (`parametrosDeRazonamientoOpenAI`): por lo mismo
 *     que el 11/09/2026 se apagó en Sonnet.
 *   · La misma pregunta no se paga dos veces (`lib/ai/cacheDeRespuestas.js`).
 *   · Cada llamada deja su fila en `master.ai_uso` (`lib/ai/usoDeIA.js`), con
 *     el `usage` de OpenAI traducido a los cuatro contadores de Anthropic
 *     (`usageAnthropicDe`) para que la contabilidad sea una sola.
 *   · Streaming cuando la respuesta es larga: aquí el timeout es de SILENCIO
 *     —se reinicia con cada trozo que llega— y no del total, que es lo que
 *     hace falta para que un registro de 12.000 tokens no muera por tamaño.
 *   · La caché de prompt no hay que pedirla: OpenAI cachea sola el prefijo
 *     repetido a partir de 1.024 tokens. `systemCacheado` se pone DELANTE del
 *     resto, byte a byte igual entre llamadas, y con eso basta.
 *
 * ── LOS ERRORES HABLAN EL MISMO IDIOMA ─────────────────────────────────────
 * Lo que se lanza lleva `status`, `code` y `proveedor: "openai"`, y los nombres
 * de red son los mismos que usa el SDK de Anthropic (`APIConnectionError`,
 * `APIConnectionTimeoutError`), para que `lib/ai/errorLegible.js` los traduzca
 * sin saber de quién vienen. El «sin saldo» de OpenAI es un 429 con
 * `insufficient_quota`, no un 400 como en Anthropic: `errorLegible` sabe de
 * los dos.
 *
 * Las funciones sin red (`peticionDeOpenAI`, `leerRespuestaDeOpenAI`,
 * `usageAnthropicDe`, `errorDeOpenAI`) están exportadas para probarlas con
 * `node:test` sin clave ni conexión (`scripts/_smoke-proveedor-ia.mjs`).
 */

import { cacheDeRespuestas } from "./cacheDeRespuestas.js";
import { parametrosDeRazonamientoOpenAI } from "./openaiModel.js";
import { contextoDeUso, registrarUso } from "./usoDeIA.js";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 120_000;

/** El system de OpenAI es una sola cadena: lo fijo delante, el resto detrás. */
export function systemDeOpenAI(system, systemCacheado) {
  const fijo = String(systemCacheado ?? "").trim();
  const resto = String(system ?? "").trim();
  return [fijo, resto].filter(Boolean).join("\n\n");
}

/**
 * El cuerpo de la petición. `user` es el mensaje único de `complete()`;
 * `messages` la conversación del asistente. Puro, para poder probarlo.
 */
export function peticionDeOpenAI({ system, systemCacheado = null, user = null, messages = null, model, maxTokens, stream = false }) {
  const sistema = systemDeOpenAI(system, systemCacheado);
  const turnos = Array.isArray(messages)
    ? messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }))
    : [{ role: "user", content: String(user ?? "") }];
  return {
    model,
    messages: [...(sistema ? [{ role: "system", content: sistema }] : []), ...turnos],
    max_completion_tokens: maxTokens,
    ...parametrosDeRazonamientoOpenAI(model),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

/**
 * El `usage` de OpenAI, en los cuatro contadores de Anthropic que guarda
 * `master.ai_uso`: lo cacheado se cobra a la décima parte, como la lectura de
 * caché de Anthropic; el resto de la entrada, a precio normal. Los tokens de
 * razonamiento vienen dentro de `completion_tokens` y se cobran como salida.
 */
export function usageAnthropicDe(usage) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  const entrada = n(usage?.prompt_tokens);
  const cacheado = Math.min(entrada, n(usage?.prompt_tokens_details?.cached_tokens));
  return {
    input_tokens: entrada - cacheado,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cacheado,
    output_tokens: n(usage?.completion_tokens),
  };
}

/** `finish_reason` de OpenAI → `stop_reason` de Anthropic, que es lo que miran los llamantes. */
export function paradaDe(finishReason) {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "length") return "max_tokens";
  return finishReason ?? null;
}

/** La respuesta sin streaming → `{ texto, parada, usage }`. */
export function leerRespuestaDeOpenAI(json) {
  const eleccion = json?.choices?.[0];
  const contenido = eleccion?.message?.content;
  const texto = (typeof contenido === "string" ? contenido : "").trim();
  return { texto, parada: paradaDe(eleccion?.finish_reason), usage: json?.usage ?? null };
}

/** Un error HTTP de OpenAI, con lo que `errorLegible.js` necesita para traducirlo. */
export function errorDeOpenAI(status, cuerpo) {
  const detalle = cuerpo?.error ?? {};
  const err = new Error(detalle.message || `OpenAI respondió ${status}`);
  err.name = "OpenAIAPIError";
  err.status = status;
  err.code = detalle.code ?? null;
  err.type = detalle.type ?? null;
  err.proveedor = "openai";
  err.error = cuerpo;
  return err;
}

function errorDeRed(e) {
  const timeout = e?.name === "AbortError" || e?.name === "TimeoutError";
  const err = new Error(timeout ? "La petición a OpenAI tardó demasiado" : "No se pudo contactar con OpenAI");
  err.name = timeout ? "APIConnectionTimeoutError" : "APIConnectionError";
  err.proveedor = "openai";
  err.cause = e;
  return err;
}

/**
 * El stream de OpenAI son líneas `data: {...}` con un trozo de texto cada una;
 * la última trae el `usage` (pedido con `stream_options`). Se junta todo aquí
 * y el llamante recibe lo MISMO que sin streaming.
 */
async function leerStream(res, latido) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let resto = "";
  let texto = "";
  let finish = null;
  let usage = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    latido();
    resto += decoder.decode(value, { stream: true });
    const lineas = resto.split("\n");
    resto = lineas.pop() ?? "";
    for (const linea of lineas) {
      const l = linea.trim();
      if (!l.startsWith("data:")) continue;
      const datos = l.slice(5).trim();
      if (!datos || datos === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(datos);
      } catch {
        continue;
      }
      const c = j.choices?.[0];
      if (typeof c?.delta?.content === "string") texto += c.delta.content;
      if (c?.finish_reason) finish = c.finish_reason;
      if (j.usage) usage = j.usage;
    }
  }
  return { texto: texto.trim(), parada: paradaDe(finish), usage };
}

async function llamar({ apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  // Con streaming, cada trozo que llega reinicia el contador: el timeout mide
  // silencio, no duración. Sin streaming, el contador es el de siempre.
  const latido = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  try {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw errorDeRed(e);
    }
    if (!res.ok) {
      let cuerpo = null;
      try {
        cuerpo = await res.json();
      } catch {
        /* sin cuerpo: el estado ya dice bastante */
      }
      throw errorDeOpenAI(res.status, cuerpo);
    }
    try {
      if (body.stream && res.body) return await leerStream(res, latido);
      return leerRespuestaDeOpenAI(await res.json());
    } catch (e) {
      if (e?.proveedor) throw e;
      throw errorDeRed(e);
    }
  } finally {
    clearTimeout(timer);
  }
}

function sinClave() {
  const err = new Error("Falta la clave de OpenAI del tenant (Configuración → Conexiones)");
  err.code = "NO_API_KEY";
  err.proveedor = "openai";
  return err;
}

/**
 * Lo mismo que `completeConParada` de `lib/outreach/analysis/anthropic.js`,
 * con ChatGPT: un system, un mensaje, y de vuelta el texto y por qué paró.
 */
export async function completarConOpenAI({
  system,
  systemCacheado = null,
  user,
  model,
  maxTokens = 8000,
  apiKey,
  stream = false,
  timeoutMs = TIMEOUT_MS,
}) {
  if (!apiKey) throw sinClave();
  const body = peticionDeOpenAI({ system, systemCacheado, user, model, maxTokens, stream });

  const clave = cacheDeRespuestas.clave({ tenant: contextoDeUso()?.tenantId ?? null, params: body });
  const previa = cacheDeRespuestas.recuperar(clave);
  if (previa) {
    void registrarUso({ proveedor: "openai", modelo: model, cacheado: true, parada: previa.parada, ms: 0 });
    return { texto: previa.texto, parada: previa.parada };
  }

  const t0 = Date.now();
  const { texto, parada, usage } = await llamar({ apiKey, body, timeoutMs });
  void registrarUso({ proveedor: "openai", modelo: model, usage: usageAnthropicDe(usage), ms: Date.now() - t0, parada });
  if (parada === "end_turn" && texto) cacheDeRespuestas.recordar(clave, { texto, parada });
  return { texto, parada };
}

/** Lo mismo que `chat` de `lib/assistant/anthropic.js`, con ChatGPT: varios turnos, vuelve el texto. */
export async function chatConOpenAI({ system, messages, model, maxTokens = 1024, apiKey, timeoutMs = 60_000 }) {
  if (!apiKey) throw sinClave();
  const body = peticionDeOpenAI({ system, messages, model, maxTokens });
  const t0 = Date.now();
  const { texto, parada, usage } = await llamar({ apiKey, body, timeoutMs });
  void registrarUso({ proveedor: "openai", modelo: model, usage: usageAnthropicDe(usage), ms: Date.now() - t0, parada });
  return texto;
}
