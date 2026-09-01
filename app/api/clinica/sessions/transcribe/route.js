import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../lib/ai/openaiKey.js";
import { getTenantAnthropicKey } from "../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../lib/ai/anthropicModel.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "../../../../../lib/clinica/whisper.js";
import { structureSession } from "../../../../../lib/clinica/structureSession.js";
import {
  bloquesDelRegistro,
  estructuraHistorica,
  materialParaLaIA,
  MAX_NOTAS,
  MAX_TRANSCRIPCION,
  propuestaDemo,
  TRANSCRIPCION_DEMO,
} from "../../../../../lib/clinica/registroCompleto.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
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
 * POST /api/clinica/sessions/transcribe — recibe el MATERIAL de la sesión (un
 * audio, un texto pegado, o los dos) y devuelve el REGISTRO ENTERO propuesto
 * (Claude): de la preparación a las notas internas, por los apartados de la
 * plantilla del centro. NO guarda nada: la profesional revisa apartado por
 * apartado y luego confirma con POST /api/clinica/sessions.
 *
 * ── EL AUDIO DEJÓ DE SER OBLIGATORIO (01/09/2026, Rodrigo) ────────────────
 * «El botón de la IA también debe poder coger texto libre, no solo la
 * transcripción del audio. Por si apuntan todo en un bloc de notas y lo pasan
 * ahí.» La ruta se sigue llamando `transcribe` —la URL la usan dos pantallas y
 * renombrarla no aporta nada—, pero transcribir es ya solo el primer paso y
 * OPCIONAL: si no hay audio, no se llama a Whisper y no se gasta un céntimo de
 * OpenAI.
 *
 * ── UN AUDIO SE TRANSCRIBE UNA SOLA VEZ (01/09/2026, Rodrigo) ─────────────
 * «Cuando intento usar la IA después de haber usado el audio, solo entiende que
 * estoy volviendo a intentar retranscribir el audio en lugar de hacerlo
 * independiente.» Antes, cada pasada volvía a SUBIR el mismo fichero y a
 * llamar a Whisper: la profesional lo pagaba dos veces, esperaba dos veces y la
 * pantalla se quedaba enganchada al audio. Ahora la pantalla manda en
 * `transcripcion` el texto que ya sacó Whisper y aquí no se transcribe nada: se
 * va derecho a Claude con el material de esta pasada, sea el que sea.
 *
 * Campos del multipart (hace falta `file`, `texto` **o** `transcripcion`):
 *   · `file`       (opcional) el audio, cuando todavía no se ha transcrito.
 *   · `texto`      (opcional) lo que haya apuntado a mano; máx. MAX_NOTAS.
 *   · `transcripcion` (opcional) lo que YA sacó Whisper en una pasada anterior.
 *                  Se usa tal cual y NO se vuelve a llamar a OpenAI. Si además
 *                  viene `file`, manda el fichero: un audio nuevo deja vieja
 *                  cualquier transcripción anterior.
 *   · `apartados`  (opcional, JSON) los del bloque 2 con los que se está
 *                  escribiendo esta sesión. Los manda la PANTALLA porque es
 *                  quien sabe qué plantilla se ha elegido y qué apartados
 *                  sueltos se han añadido a mano; sin ellos se usan los siete
 *                  de fábrica y la propuesta se queda como estaba antes.
 *   · `escrito`    (opcional, JSON) lo ya tecleado, como contexto para que la
 *                  propuesta no contradiga a la profesional.
 *
 * Devuelve `transcription` (lo que sacó Whisper, vacío si no hubo audio) y
 * `material` (lo que ha LEÍDO Claude: transcripción y/o notas). Son dos cosas
 * distintas y la pantalla usa cada una para lo suyo — enseñar la transcripción
 * literal, y guardar de qué texto salió el registro.
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

  // El formulario se lee LO PRIMERO: de él depende hasta qué claves hacen falta
  // —sin audio no se llama a Whisper— y también el modo fake tiene que respetar
  // los apartados del centro, o en local se probaría otra pantalla distinta de
  // la que ve el cliente.
  let form = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const apartados = jsonDelForm(form, "apartados");
  const escrito = jsonDelForm(form, "escrito");
  const notas = String(form?.get("texto") ?? "").trim();
  const subido = form?.get("file");
  const file = subido && typeof subido !== "string" ? subido : null;
  // Un audio nuevo deja vieja la transcripción anterior: si vienen los dos,
  // manda el fichero y esto se descarta.
  const yaTranscrito = file ? "" : String(form?.get("transcripcion") ?? "").trim();

  if (!file && !notas && !yaTranscrito) return error("Sube un audio o pega tus notas de la sesión.");
  if (notas.length > MAX_NOTAS) {
    return error(`Las notas no pueden pasar de ${MAX_NOTAS.toLocaleString("es-ES")} caracteres.`, 413);
  }
  // La transcripción no se mide con la vara de las notas —25 MB de audio dan
  // muchísimo más de 20.000 caracteres—, pero tampoco entra sin tope: viene por
  // el formulario y hay que acotar el cuerpo de la petición.
  if (yaTranscrito.length > MAX_TRANSCRIPCION) {
    return error("La transcripción es demasiado larga para volver a procesarla.", 413);
  }
  if (file && typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
    return error("El audio supera el máximo de 25 MB", 413);
  }

  // La clave de OpenAI solo hace falta si hay audio: un registro escrito a mano
  // no pasa por Whisper y no tiene por qué exigir una clave que el centro
  // podría no tener puesta.
  const fake = isDev && (process.env.CLINICA_FAKE_AI === "1" || !anthropicKey || (file && !openaiKey));
  if (!fake) {
    if (file && !openaiKey) return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);
    if (!anthropicKey) return error("Configura la clave de Anthropic en Configuración → IA para estructurar la sesión.", 400);
  }

  if (fake) {
    const bloques = bloquesDelRegistro(apartados);
    const propuesta = propuestaDemo(bloques);
    const transcription = file ? TRANSCRIPCION_DEMO : yaTranscrito;
    return ok({
      transcription,
      material: materialParaLaIA({ transcripcion: transcription, notas }),
      propuesta,
      structured: estructuraHistorica(propuesta),
      audioDurationSec: file ? 61 : null,
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
      console.error("[clinica:whisper]", e);
      return error("La transcripción del audio ha fallado. Inténtalo de nuevo.", 502);
    }
    // Un audio mudo solo es un callejón sin salida si no hay nada más: con
    // notas pegadas el registro se puede hacer igual, y avisando.
    if (!transcription && !notas) return error("La transcripción salió vacía. ¿El audio tiene voz?", 422);
  }

  const material = materialParaLaIA({ transcripcion: transcription, notas });
  const avisoAudioMudo =
    file && !transcription ? "Del audio no ha salido texto (¿tiene voz?). La propuesta sale solo de tus notas." : null;

  let structured;
  let propuesta;
  let incidencia = null;
  try {
    const r = await structureSession({
      transcription: material,
      apartados,
      escrito,
      apiKey: anthropicKey,
      model: getTenantAnthropicModel(ctx),
    });
    propuesta = r.propuesta;
    structured = r.structured;
    incidencia = r.incidencia;
  } catch (e) {
    if (e.code === "NO_API_KEY") return error("El resumen con IA no está configurado (falta la clave de Anthropic).", 503);
    console.error("[clinica:structure]", e);
    // La transcripción ya está hecha y pagada: se devuelve aunque el reparto
    // falle, para que no haya que volver a subir el audio. La pantalla enseña
    // el texto y la profesional escribe a mano.
    return ok({
      transcription,
      material,
      propuesta: {},
      structured: null,
      audioDurationSec,
      demo: false,
      avisoIA: file
        ? "El audio se ha transcrito, pero el reparto por apartados ha fallado. Tienes la transcripción abajo para escribir el registro a mano o volver a intentarlo."
        : "El reparto por apartados ha fallado. Tus notas siguen aquí: vuelve a intentarlo o escribe el registro a mano.",
    });
  }

  // Lo que le pasó a la respuesta de Claude, dicho en cristiano. Antes esto no
  // salía de aquí y una respuesta cortada llegaba a la pantalla como «la IA no
  // ha sacado nada que repartir» — que es lo contrario de lo que pasó.
  const avisoIncidencia =
    incidencia === "cortada"
      ? "La IA se ha quedado sin sitio antes de terminar: tienes lo que llegó entero. Revisa si falta algún apartado y, si falta, vuelve a procesar."
      : incidencia === "ilegible" || incidencia === "vacia"
        ? "La IA ha contestado en un formato que no se ha podido leer. Vuelve a procesar: no hay que subir el audio otra vez."
        : null;

  return ok({
    transcription,
    material,
    propuesta,
    structured,
    audioDurationSec,
    demo: false,
    ...(avisoAudioMudo || avisoIncidencia ? { avisoIA: avisoAudioMudo ?? avisoIncidencia } : {}),
  });
});
