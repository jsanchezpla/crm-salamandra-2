import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../lib/ai/openaiKey.js";
import { getTenantAnthropicKey } from "../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../lib/ai/anthropicModel.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "../../../../../lib/clinica/whisper.js";
import { structureSession } from "../../../../../lib/clinica/structureSession.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Datos canned para desarrollo/demo local (sin claves ni audio real). BLOQUEADO en
// producción: allí siempre se usan las APIs reales con la clave del tenant.
const DEMO = {
  transcription:
    "Hoy hemos trabajado atención con un memory. También toma de decisiones, velocidad de procesamiento y flexibilidad cognitiva, con escenarios escolares para que decidiera entre dos opciones. Le he visto bastante concentrado, mejor que la semana pasada, y ha completado el memory con menos distracciones. La madre me ha comentado al recoger que ha mejorado con los deberes en casa. Para casa le he puesto ejercicios de atención cinco minutos antes del estudio.",
  structured: {
    objectives: ["Atención sostenida", "Toma de decisiones", "Velocidad de procesamiento", "Flexibilidad cognitiva"],
    activities: "Memory con piezas progresivas y ejercicios de toma de decisiones con escenarios escolares.",
    performance: "Mayor concentración respecto a sesiones anteriores; completó el memory con menos distracciones.",
    observations: {
      familyComments: "La madre refiere mejora notable en la realización de los deberes.",
      nextSessionNotes: "Continuar con flexibilidad cognitiva; introducir planificación.",
      homeworkTasks: "Ejercicios de atención 5 minutos antes del estudio.",
      incidents: "Ninguna.",
    },
  },
  audioDurationSec: 47,
};

/**
 * POST /api/clinica/sessions/transcribe — recibe el audio (multipart) y devuelve la
 * transcripción (Whisper/OpenAI) + el registro estructurado (Claude). NO guarda nada:
 * la terapeuta revisa/edita y luego confirma con POST /api/clinica/sessions.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // La demo es pública (sesión admin anónima): nunca llamar a Whisper/Claude
  // con la clave del tenant. Aquí no se puede simular (el modo fake está
  // limitado a desarrollo), así que se corta.
  assertNotDemoPaidCall(ctx, "La transcripción por voz");

  const veto = await vetoAi(ctx, request, "transcribir una sesión clínica");
  if (veto) return veto;

  const isDev = process.env.NODE_ENV !== "production";
  const openaiKey = getTenantOpenAIKey(ctx);
  const anthropicKey = getTenantAnthropicKey(ctx);
  const fake = isDev && (process.env.CLINICA_FAKE_AI === "1" || !openaiKey || !anthropicKey);

  if (!fake) {
    if (!openaiKey) return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);
    if (!anthropicKey) return error("Configura la clave de Anthropic en Configuración → IA para estructurar la sesión.", 400);
  }

  if (fake) {
    return ok({ ...DEMO, demo: true });
  }

  // ── Real: multipart → Whisper → Claude ──
  let form;
  try {
    form = await request.formData();
  } catch {
    return error("Se esperaba un formulario con el audio");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return error("Falta el archivo de audio");
  if (typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) return error("El audio supera el máximo de 25 MB", 413);

  let transcription;
  let audioDurationSec;
  try {
    const t = await transcribeAudio({ file, apiKey: openaiKey });
    transcription = t.text;
    audioDurationSec = t.durationSec;
  } catch (e) {
    if (e.code === "BAD_KEY") return error("Tu clave de OpenAI no es válida o no tiene permisos.", 400);
    if (e.code === "QUOTA") return error("Has alcanzado el límite o la cuota de OpenAI.", 429);
    if (e.code === "TOO_LARGE") return error(e.message, 413);
    if (e.code === "UNREACHABLE") return error(e.message, 504);
    console.error("[clinica:whisper]", e);
    return error("La transcripción del audio ha fallado. Inténtalo de nuevo.", 502);
  }
  if (!transcription) return error("La transcripción salió vacía. ¿El audio tiene voz?", 422);

  let structured;
  try {
    structured = await structureSession({ transcription, apiKey: anthropicKey, model: getTenantAnthropicModel(ctx) });
  } catch (e) {
    if (e.code === "NO_API_KEY") return error("El resumen con IA no está configurado (falta la clave de Anthropic).", 503);
    console.error("[clinica:structure]", e);
    return error("El resumen de la sesión con IA ha fallado. Inténtalo de nuevo.", 502);
  }

  return ok({ transcription, structured, audioDurationSec, demo: false });
});
