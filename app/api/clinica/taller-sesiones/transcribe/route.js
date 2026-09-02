import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../lib/ai/openaiKey.js";
import { getTenantAnthropicKey } from "../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../lib/ai/anthropicModel.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "../../../../../lib/clinica/whisper.js";
import { structureTaller } from "../../../../../lib/clinica/structureTaller.js";
import { materialParaLaIA, MAX_NOTAS, MAX_TRANSCRIPCION } from "../../../../../lib/clinica/registroCompleto.js";
import {
  bloquesDelTaller,
  propuestaDemoTaller,
  repartirPropuestaDeTaller,
  TRANSCRIPCION_DEMO_TALLER,
} from "../../../../../lib/clinica/tallerCompleto.js";

function gate(ctx) {
  return ctx.hasModule("clinica");
}

/** Lee un campo del formulario que viaja como JSON. Ante la duda, `null`. */
function jsonDelForm(form, campo) {
  const v = form?.get(campo);
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/**
 * POST /api/clinica/taller-sesiones/transcribe — el audio y la IA en la sesión
 * de TALLER (03/09/2026, Rodrigo: «añade audio e IA a la sesión de taller»).
 *
 * Gemela de `sessions/transcribe` y con las mismas reglas: recibe el MATERIAL
 * (un audio, unas notas, o los dos), transcribe el audio UNA sola vez y le pide
 * a Claude el registro entero del taller — el cuerpo común del grupo, la nota
 * individual de cada asistente y las notas internas—. NO guarda nada: la
 * profesional revisa bloque a bloque en la pantalla y luego guarda el taller
 * como siempre (POST/PUT de la sesión de taller).
 *
 * Campos del multipart (hace falta `file`, `texto` **o** `transcripcion`):
 *   · `file`          (opcional) el audio, cuando todavía no se ha transcrito.
 *   · `texto`         (opcional) lo apuntado a mano; máx. MAX_NOTAS.
 *   · `transcripcion` (opcional) lo que YA sacó Whisper en una pasada anterior;
 *                     se usa tal cual y no se vuelve a llamar a OpenAI.
 *   · `apartados`     (JSON) los apartados COMUNES con los que se escribe el
 *                     taller (la plantilla elegida, con los sueltos añadidos).
 *   · `asistentes`    (JSON) `[{ patientId, nombre }]` de los que VINIERON: son
 *                     los únicos que tienen bloque de nota. Sin lista, la IA
 *                     no propone notas individuales.
 *   · `etiquetaNota`  (opcional) cómo se titula la nota individual.
 *   · `escrito`       (opcional, JSON) lo ya tecleado, por clave de bloque.
 *
 * Devuelve `transcription` (lo que sacó Whisper, vacío si no hubo audio),
 * `material` (lo que leyó Claude), `propuesta` (plana, por clave de bloque),
 * `reparto` (`{ comunes, notas, internalNotes }`, ya separado) y `bloques`.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // La demo es pública (sesión admin anónima): nunca gastar Whisper/Claude.
  assertNotDemoPaidCall(ctx, "La transcripción por voz");

  const veto = await vetoAi(ctx, request, "transcribir una sesión de taller");
  if (veto) return veto;

  const isDev = process.env.NODE_ENV !== "production";
  const openaiKey = getTenantOpenAIKey(ctx);
  const anthropicKey = getTenantAnthropicKey(ctx);

  let form = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const apartados = jsonDelForm(form, "apartados");
  const asistentes = jsonDelForm(form, "asistentes");
  const escrito = jsonDelForm(form, "escrito");
  const etiquetaNota = String(form?.get("etiquetaNota") ?? "").trim();
  const notas = String(form?.get("texto") ?? "").trim();
  const subido = form?.get("file");
  const file = subido && typeof subido !== "string" ? subido : null;
  // Un audio nuevo deja vieja la transcripción anterior.
  const yaTranscrito = file ? "" : String(form?.get("transcripcion") ?? "").trim();

  if (!file && !notas && !yaTranscrito) return error("Sube un audio o pega tus notas del taller.");
  if (notas.length > MAX_NOTAS) {
    return error(`Las notas no pueden pasar de ${MAX_NOTAS.toLocaleString("es-ES")} caracteres.`, 413);
  }
  if (yaTranscrito.length > MAX_TRANSCRIPCION) {
    return error("La transcripción es demasiado larga para volver a procesarla.", 413);
  }
  if (file && typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
    return error("El audio supera el máximo de 25 MB", 413);
  }

  // Mismo modo canned que el registro normal: LIMITADO a desarrollo.
  const fake = isDev && (process.env.CLINICA_FAKE_AI === "1" || !anthropicKey || (file && !openaiKey));
  if (!fake) {
    if (file && !openaiKey) return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);
    if (!anthropicKey) return error("Configura la clave de Anthropic en Configuración → IA para estructurar la sesión.", 400);
  }

  if (fake) {
    const bloques = bloquesDelTaller({ apartados, asistentes, etiquetaNota });
    const propuesta = propuestaDemoTaller(bloques);
    const transcription = file ? TRANSCRIPCION_DEMO_TALLER : yaTranscrito;
    return ok({
      transcription,
      material: materialParaLaIA({ transcripcion: transcription, notas }),
      propuesta,
      reparto: repartirPropuestaDeTaller(propuesta, bloques),
      bloques,
      audioDurationSec: file ? 74 : null,
      demo: true,
    });
  }

  // ── Real: (audio → Whisper, solo la primera vez) + notas → Claude ──
  let transcription = yaTranscrito;
  let audioDurationSec = null;
  if (file) {
    try {
      const t = await transcribeAudio({ file, apiKey: openaiKey });
      transcription = t.text;
      audioDurationSec = t.durationSec;
    } catch (e) {
      if (e.code === "BAD_KEY") return error("Tu clave de OpenAI no es válida o no tiene permisos.", 400);
      if (e.code === "QUOTA") return error("Has alcanzado el límite o la cuota de OpenAI.", 429);
      if (e.code === "TOO_LARGE") return error(e.message, 413);
      if (e.code === "UNREACHABLE") return error(e.message, 504);
      console.error("[clinica:whisper-taller]", e);
      return error("La transcripción del audio ha fallado. Inténtalo de nuevo.", 502);
    }
    if (!transcription && !notas) return error("La transcripción salió vacía. ¿El audio tiene voz?", 422);
  }

  const material = materialParaLaIA({ transcripcion: transcription, notas });
  const avisoAudioMudo =
    file && !transcription ? "Del audio no ha salido texto (¿tiene voz?). La propuesta sale solo de tus notas." : null;

  let r;
  try {
    r = await structureTaller({
      transcription: material,
      apartados,
      asistentes,
      etiquetaNota,
      escrito,
      apiKey: anthropicKey,
      model: getTenantAnthropicModel(ctx),
    });
  } catch (e) {
    if (e.code === "NO_API_KEY") return error("El resumen con IA no está configurado (falta la clave de Anthropic).", 503);
    console.error("[clinica:structure-taller]", e);
    // La transcripción ya está hecha y pagada: se devuelve aunque el reparto
    // falle, para que no haya que volver a subir el audio.
    return ok({
      transcription,
      material,
      propuesta: {},
      reparto: { comunes: {}, notas: {}, internalNotes: "" },
      bloques: bloquesDelTaller({ apartados, asistentes, etiquetaNota }),
      audioDurationSec,
      demo: false,
      avisoIA: file
        ? "El audio se ha transcrito, pero el reparto por apartados ha fallado. Tienes la transcripción abajo para escribir el registro a mano o volver a intentarlo."
        : "El reparto por apartados ha fallado. Tus notas siguen aquí: vuelve a intentarlo o escribe el registro a mano.",
    });
  }

  const avisoIncidencia =
    r.incidencia === "cortada"
      ? "La IA se ha quedado sin sitio antes de terminar: tienes lo que llegó entero. Revisa si falta algún apartado y, si falta, vuelve a procesar."
      : r.incidencia === "ilegible" || r.incidencia === "vacia"
        ? "La IA ha contestado en un formato que no se ha podido leer. Vuelve a procesar: no hay que subir el audio otra vez."
        : null;

  return ok({
    transcription,
    material,
    propuesta: r.propuesta,
    reparto: r.reparto,
    bloques: r.bloques,
    audioDurationSec,
    demo: false,
    ...(avisoAudioMudo || avisoIncidencia ? { avisoIA: avisoAudioMudo ?? avisoIncidencia } : {}),
  });
});
