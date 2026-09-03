import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall, demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../../lib/ai/openaiKey.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "../../../../../../lib/clinica/whisper.js";

/**
 * POST /api/pacientes/[id]/plan/transcribir ⚡ Whisper
 *
 * Dictar las ideas clave del Plan con un audio (03/09/2026, Rodrigo por la
 * vuelta de AV-0019 de Aumenta: «lo único que aún no tenemos en el plan es lo
 * de adjuntar audio»). Recibe un audio (multipart, campo `file`), lo pasa por
 * Whisper y devuelve el TEXTO. No guarda nada y no llama a Claude: el texto
 * cae en la caja de ideas clave y es la terapeuta quien pulsa «Proponer
 * objetivos», que es el paso que ya existía (`objetivos-ia`).
 *
 * Misma cadena que el resto de la IA clínica: clave del TENANT (BYOK), `vetoAi`
 * por persona, la demo simulada. La grabación en el navegador o el archivo
 * elegido llegan igual: un `File` de audio.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const veto = await vetoAi(ctx, request, "dictar las ideas clave del plan");
    if (veto) return veto;

    const { Patient } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id"] });
    if (!paciente) return notFound("Paciente no encontrado");

    let form = null;
    try {
      form = await request.formData();
    } catch {
      form = null;
    }
    const subido = form?.get("file");
    const file = subido && typeof subido !== "string" ? subido : null;
    if (!file) return error("Graba o elige un audio con las ideas clave.");
    if (typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
      return error("El audio supera el máximo de 25 MB", 413);
    }

    // La demo es pública: nunca Whisper con la clave del tenant. En local sin
    // clave se devuelve un texto de ensayo para poder probar la pantalla.
    if (demoForcesFakeAi(ctx)) {
      return ok({
        texto: "Respetar los turnos de palabra en juegos de reglas. Frases de tres elementos con apoyo visual. Tolerar la frustración al perder.",
        durationSec: 12,
        fake: true,
      });
    }
    assertNotDemoPaidCall(ctx, "La transcripción por voz");

    const apiKey = getTenantOpenAIKey(ctx);
    if (!apiKey) return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);

    const { text, durationSec } = await transcribeAudio({ file, apiKey });
    const texto = String(text ?? "").trim();
    if (!texto) return error("No se ha entendido nada en el audio. Prueba a grabar más cerca del micrófono.", 422);
    return ok({ texto, durationSec: durationSec ?? null, fake: false });
  } catch (err) {
    if (err?.code === "NO_OPENAI_KEY") {
      return error("Este cliente no tiene configurada la clave de OpenAI (Configuración → IA)", 503);
    }
    if (err?.code === "BAD_KEY" || err?.code === "QUOTA" || err?.code === "UNREACHABLE" || err?.code === "TOO_LARGE") {
      return error(err.message, 502);
    }
    return serverError(err);
  }
});
