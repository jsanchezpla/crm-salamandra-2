import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../lib/ai/openaiKey.js";
import { transcribirVarios } from "../../../../../lib/clinica/whisper.js";
import { MAX_AUDIO_BYTES, MAX_AUDIOS } from "../../../../../lib/clinica/audios.js";
import { TRANSCRIPCION_DEMO } from "../../../../../lib/clinica/registroCompleto.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/** El HTTP que le toca a cada fallo de Whisper. Mismo reparto que en `sessions/transcribe`. */
const HTTP_POR_CODIGO = { BAD_KEY: 400, QUOTA: 429, TOO_LARGE: 413, UNREACHABLE: 504 };

/**
 * POST /api/clinica/audio/transcribir — SOLO transcribe. Recibe uno o varios
 * `file` y devuelve el texto de cada uno. No llama a Claude, no guarda nada.
 *
 * ── POR QUÉ UN ENDPOINT APARTE (04/09/2026, Rodrigo) ───────────────────────
 * «La transcripción por IA va un poco lenta, y queremos subir más de un audio
 * antes de ponerlo a transcribir.» Las dos cosas son la misma: hasta hoy
 * transcribir y repartir por apartados iban pegadas en una sola petición
 * (`sessions/transcribe`), así que la profesional pulsaba un botón y esperaba
 * de brazos cruzados a Whisper Y a Claude, con un audio cada vez.
 *
 * Partiéndolo, la pantalla puede mandar los audios a transcribir mientras ella
 * sigue escribiendo el registro: cuando pulse el botón de la IA, la
 * transcripción ya está hecha y solo se espera el reparto. El texto vuelve a
 * ella y en la pasada de IA viaja como `transcripcion` — la misma vía que ya
 * existía para no pagar dos veces el mismo audio.
 *
 * Los audios de una tanda se transcriben EN PARALELO (`transcribirVarios`):
 * cuatro notas de voz cuestan lo que la más larga, no lo que las cuatro.
 *
 * Devuelve `audios: [{ nombre, texto, durationSec, error }]` en el mismo orden
 * en que llegaron. Un audio que falla vuelve con su `error` y no tumba a los
 * demás; solo si fallan TODOS se devuelve un HTTP de error, que es cuando de
 * verdad no hay nada que enseñar.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // La demo es pública (sesión admin anónima): nunca llamar a Whisper con la
  // clave del tenant.
  assertNotDemoPaidCall(ctx, "La transcripción por voz");

  const veto = await vetoAi(ctx, request, "transcribir audios de una sesión");
  if (veto) return veto;

  let form = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const files = (form?.getAll("file") ?? []).filter((f) => f && typeof f !== "string");
  if (!files.length) return error("No ha llegado ningún audio.");
  if (files.length > MAX_AUDIOS) return error(`No se pueden transcribir más de ${MAX_AUDIOS} audios a la vez.`, 413);
  const gordo = files.find((f) => typeof f.size === "number" && f.size > MAX_AUDIO_BYTES);
  if (gordo) return error(`«${gordo.name || "El audio"}» supera el máximo de 25 MB`, 413);

  const openaiKey = getTenantOpenAIKey(ctx);
  const fake = process.env.NODE_ENV !== "production" && (process.env.CLINICA_FAKE_AI === "1" || !openaiKey);
  if (fake) {
    return ok({
      audios: files.map((f, i) => ({
        nombre: f.name || `audio ${i + 1}`,
        texto: TRANSCRIPCION_DEMO,
        durationSec: 61,
        error: null,
      })),
      demo: true,
    });
  }
  if (!openaiKey) return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);

  const t0 = Date.now();
  const { resultados } = await transcribirVarios({ files, apiKey: openaiKey });
  console.info("[clinica:transcribir]", files.length, "audio(s)", `${Date.now() - t0}ms`);

  // Todos rotos: no hay nada que enseñar, así que esto es un error de verdad y
  // no una lista de fallos. Se contesta con el código del primero, que en la
  // práctica es el mismo para todos (clave mala, cuota, OpenAI caído).
  if (resultados.every((r) => r.error)) {
    const primero = resultados[0];
    const http = HTTP_POR_CODIGO[primero.code] ?? 502;
    if (primero.code === "BAD_KEY") return error("Tu clave de OpenAI no es válida o no tiene permisos.", 400);
    if (primero.code === "QUOTA") return error("Has alcanzado el límite o la cuota de OpenAI.", 429);
    if (!HTTP_POR_CODIGO[primero.code]) console.error("[clinica:whisper]", primero.error);
    return error(
      files.length === 1 ? primero.error : `Ninguno de los ${files.length} audios se ha podido transcribir: ${primero.error}`,
      http
    );
  }

  return ok({
    audios: resultados.map(({ nombre, texto, durationSec, error: fallo }) => ({
      nombre,
      texto,
      durationSec,
      error: fallo,
    })),
    demo: false,
  });
});
