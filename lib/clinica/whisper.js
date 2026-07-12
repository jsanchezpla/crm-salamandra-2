/**
 * Transcripción de audio con la API de Whisper de OpenAI (voz → texto). Se llama
 * server-to-server con la clave del tenant (Configuración → IA, BYOK). No añade la
 * dependencia del SDK de OpenAI: usa la REST API directamente con fetch + FormData
 * (globales en el runtime Node de Next).
 *
 * Los errores llevan `code` para que el Route Handler los traduzca a un HTTP claro.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 120_000;
export const WHISPER_MODEL = "whisper-1";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // límite de la API de OpenAI

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
