/**
 * Transcripción de audio con la API de Whisper de OpenAI (voz → texto). Se llama
 * server-to-server con la clave del tenant (Configuración → IA, BYOK). No añade la
 * dependencia del SDK de OpenAI: usa la REST API directamente con fetch + FormData
 * (globales en el runtime Node de Next).
 *
 * Los errores llevan `code` para que el Route Handler los traduzca a un HTTP claro.
 */

import { A_LA_VEZ, MAX_AUDIO_BYTES, duracionTotal, juntarTranscripciones } from "./audios.js";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 120_000;
export const WHISPER_MODEL = "whisper-1";
// El tope vive en `audios.js`, que es lo que también lee la pantalla. Se
// reexporta porque los tres endpoints que transcriben lo piden por aquí.
export { MAX_AUDIO_BYTES };

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * @param {{ file: Blob, apiKey: string, language?: string, model?: string }} args
 * @returns {Promise<{ text: string, durationSec: number|null }>}
 */
export async function transcribeAudio({ file, apiKey, language = "es", model = WHISPER_MODEL }) {
  if (!apiKey) throw err("Falta la clave de OpenAI", "NO_OPENAI_KEY");
  if (!file) throw err("Falta el archivo de audio", "NO_FILE");
  if (typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
    throw err("El audio supera el máximo de 25 MB de la API de transcripción", "TOO_LARGE");
  }

  const form = new FormData();
  form.append("file", file, file.name || "audio");
  form.append("model", model);
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json"); // trae también la duración

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    throw err(e.name === "AbortError" ? "La transcripción tardó demasiado" : "No se pudo contactar con OpenAI", "UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) throw err("Clave de OpenAI inválida o sin permisos", "BAD_KEY");
  if (res.status === 429) throw err("Límite o cuota de OpenAI alcanzada", "QUOTA");
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw err(detail || `OpenAI respondió ${res.status}`, "ERROR");
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw err("OpenAI no devolvió JSON válido", "ERROR");
  }
  return { text: (data.text || "").trim(), durationSec: data.duration != null ? Math.round(data.duration) : null };
}

/**
 * Varios audios de una misma sesión → un solo texto, EN PARALELO (04/09/2026,
 * Rodrigo: «la transcripción por IA va un poco lenta»).
 *
 * En serie, cuatro notas de voz de tres minutos son cuatro esperas seguidas.
 * A la vez, la espera es la del audio más largo: OpenAI no cobra por la
 * concurrencia y el CRM no hace otra cosa mientras tanto. `A_LA_VEZ` acota
 * cuántas peticiones se abren de golpe, para no comerse el límite por minuto
 * de la cuenta del cliente con una tanda grande.
 *
 * Un audio que falla NO tumba a los demás: vuelve con su `error` puesto y el
 * resto con su texto. Quien llama decide si eso es un aviso o un corte —para
 * un registro clínico, tres de cuatro transcritos siguen valiendo.
 *
 * @returns {Promise<{ resultados: Array<{nombre:string,texto:string,durationSec:number|null,error:string|null,code:string|null}>, texto: string, durationSec: number|null }>}
 */
export async function transcribirVarios({ files, apiKey, language = "es", model = WHISPER_MODEL }) {
  const lista = Array.from(files ?? []);
  const resultados = new Array(lista.length);
  let siguiente = 0;

  async function trabajar() {
    for (;;) {
      const i = siguiente++;
      if (i >= lista.length) return;
      const f = lista[i];
      const nombre = f?.name || `audio ${i + 1}`;
      const t0 = Date.now();
      try {
        const t = await transcribeAudio({ file: f, apiKey, language, model });
        resultados[i] = { nombre, texto: t.text, durationSec: t.durationSec, error: null, code: null };
      } catch (e) {
        resultados[i] = { nombre, texto: "", durationSec: null, error: e.message, code: e.code ?? "ERROR" };
      }
      // Lo único que queda del reparto de tiempos cuando algo va lento en
      // producción: sin esto, «tarda» no se puede investigar.
      console.info("[clinica:whisper] audio", i + 1, "de", lista.length, `${Date.now() - t0}ms`, resultados[i].error ? "ERROR" : "ok");
    }
  }

  await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, lista.length) }, trabajar));

  return {
    resultados,
    texto: juntarTranscripciones(resultados.map((r) => r.texto)),
    durationSec: duracionTotal(resultados.map((r) => r.durationSec)),
  };
}
