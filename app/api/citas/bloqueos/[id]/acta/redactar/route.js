import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../../lib/ai/aiAccess.js";
import { getTenantOpenAIKey } from "../../../../../../../lib/ai/openaiKey.js";
import { getTenantAnthropicKey } from "../../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../../lib/ai/anthropicModel.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "../../../../../../../lib/clinica/whisper.js";
import { materialParaLaIA, MAX_NOTAS } from "../../../../../../../lib/clinica/registroCompleto.js";
import { apartadosConPlantillas, plantillasDe } from "../../../../../../../lib/clinica/plantillas.js";
import { DOC_ACTA, bloquesDelActa, puedeTenerActa } from "../../../../../../../lib/reuniones/acta.js";
import { redactarActa } from "../../../../../../../lib/reuniones/redactarActa.js";

/**
 * POST /api/citas/bloqueos/[id]/acta/redactar — recibe el material de la
 * reunión (un audio, unas notas pegadas, o los dos) y devuelve el ACTA
 * PROPUESTA, repartida por los apartados de la plantilla del centro.
 *
 * **NO GUARDA NADA.** Quien estuvo en la reunión lee la propuesta, la corrige y
 * confirma con `PUT /api/citas/bloqueos/[id]/acta`. Es el mismo reparto que en
 * el registro de sesión (`/api/clinica/sessions/transcribe`) y por la misma
 * razón: un acta la firma una persona, no un modelo.
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Que las haga directamente el CRM a través de un audio o unas notas que le
 * suba, como los registros de sesión» (Rodrigo, 01/09/2026).
 *
 * El audio es OPCIONAL desde el primer día, como acabó siéndolo en el registro:
 * quien apunta la reunión en un bloc de notas pega el texto y no se llama a
 * Whisper — ni se gasta un céntimo de OpenAI.
 *
 * Campos del multipart (hace falta `file` **o** `texto`, o los dos):
 *   · `file`      (opcional) el audio de la reunión.
 *   · `texto`     (opcional) las notas apuntadas a mano; máx. MAX_NOTAS.
 *   · `apartados` (opcional, JSON) con los que se está escribiendo esta acta.
 *                 Los manda la pantalla porque es quien sabe qué plantilla se
 *                 ha elegido; sin ellos se usan los del centro.
 *   · `escrito`   (opcional, JSON) lo ya tecleado, para no contradecirlo.
 *
 * ── LO QUE VE CLAUDE, Y LO QUE NO ───────────────────────────────────────────
 * Va la fecha de la reunión (para convertir «el martes que viene» en un día) y
 * los NOMBRES del equipo (para escribirlos bien). No va ni un dato de paciente:
 * si en la reunión se habló de un caso, el prompt le pide el asunto sin
 * historia clínica.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** «miércoles, 2 de septiembre de 2026, 12:00» — en hora de Madrid, como todo. */
function cuandoLegible(bloqueo) {
  if (!bloqueo?.startAt) return null;
  const d = new Date(bloqueo.startAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  // Las cuatro demos son públicas con sesión de admin: nunca gastar la clave
  // del tenant desde ahí.
  assertNotDemoPaidCall(ctx, "La redacción del acta");

  const veto = await vetoAi(ctx, request, "redactar un acta de reunión");
  if (veto) return veto;

  const { id } = await params;
  if (!UUID_RE.test(String(id ?? ""))) return notFound("Bloqueo no encontrado");
  const { TeamBlock, TeamMember } = ctx.tenantModels;
  const bloqueo = TeamBlock ? await TeamBlock.findByPk(id) : null;
  if (!bloqueo) return notFound("Bloqueo no encontrado");
  if (!puedeTenerActa(bloqueo)) {
    return error("Solo los bloqueos de la categoría «Reunión de equipo» llevan acta", 409);
  }

  let form = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const apartadosPedidos = jsonDelForm(form, "apartados");
  const escrito = jsonDelForm(form, "escrito");
  const notas = String(form?.get("texto") ?? "").trim();
  const subido = form?.get("file");
  const file = subido && typeof subido !== "string" ? subido : null;

  if (!file && !notas) return error("Sube el audio de la reunión o pega tus notas.");
  if (notas.length > MAX_NOTAS) {
    return error(`Las notas no pueden pasar de ${MAX_NOTAS.toLocaleString("es-ES")} caracteres.`, 413);
  }
  if (file && typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
    return error("El audio supera el máximo de 25 MB", 413);
  }

  const apartados = Array.isArray(apartadosPedidos) && apartadosPedidos.length
    ? apartadosPedidos
    : apartadosConPlantillas(bloqueo.actaSections, plantillasDe(ctx.tenant, DOC_ACTA));

  const openaiKey = getTenantOpenAIKey(ctx);
  const anthropicKey = getTenantAnthropicKey(ctx);
  // La clave de OpenAI solo hace falta si hay audio: un acta escrita a mano no
  // pasa por Whisper y no tiene por qué exigir una clave que el centro podría
  // no tener puesta.
  if (file && !openaiKey) {
    return error("Configura la clave de OpenAI en Configuración → IA para transcribir el audio.", 400);
  }
  if (!anthropicKey) {
    return error("Configura la clave de Anthropic en Configuración → IA para redactar el acta.", 400);
  }

  // ── (audio → Whisper) + notas → Claude ──
  let transcripcion = "";
  let audioDurationSec = null;
  if (file) {
    try {
      const t = await transcribeAudio({ file, apiKey: openaiKey });
      transcripcion = t.text;
      audioDurationSec = t.durationSec;
    } catch (e) {
      if (e.code === "BAD_KEY") return error("Tu clave de OpenAI no es válida o no tiene permisos.", 400);
      if (e.code === "QUOTA") return error("Has alcanzado el límite o la cuota de OpenAI.", 429);
      if (e.code === "TOO_LARGE") return error(e.message, 413);
      if (e.code === "UNREACHABLE") return error(e.message, 504);
      console.error("[reuniones:whisper]", e);
      return error("La transcripción del audio ha fallado. Inténtalo de nuevo.", 502);
    }
    if (!transcripcion && !notas) return error("La transcripción salió vacía. ¿El audio tiene voz?", 422);
  }

  const material = materialParaLaIA({ transcripcion, notas });

  // Los nombres del equipo son una ayuda de ORTOGRAFÍA para Claude, no una
  // lista de asistentes: quién vino lo dice el audio (ver el prompt).
  let equipo = [];
  try {
    const filas = TeamMember
      ? await TeamMember.findAll({ attributes: ["displayName"], where: { status: "active" }, limit: 60 })
      : [];
    equipo = filas.map((t) => t.displayName).filter(Boolean);
  } catch {
    equipo = []; // sin plantilla accesible el acta se redacta igual
  }

  try {
    const { propuesta } = await redactarActa({
      material,
      apartados,
      escrito,
      cuando: cuandoLegible(bloqueo),
      equipo,
      apiKey: anthropicKey,
      model: getTenantAnthropicModel(ctx),
    });
    return ok({
      transcripcion,
      material,
      propuesta,
      bloques: bloquesDelActa(apartados),
      audioDurationSec,
      ...(file && !transcripcion
        ? { avisoIA: "Del audio no ha salido texto (¿tiene voz?). El acta sale solo de tus notas." }
        : {}),
    });
  } catch (e) {
    if (e.code === "NO_API_KEY") return error("La redacción con IA no está configurada (falta la clave de Anthropic).", 503);
    console.error("[reuniones:acta]", e);
    // La transcripción ya está hecha y pagada: se devuelve aunque el reparto
    // falle, para no tener que volver a subir el audio de la reunión.
    return ok({
      transcripcion,
      material,
      propuesta: {},
      bloques: bloquesDelActa(apartados),
      audioDurationSec,
      avisoIA: file
        ? "El audio se ha transcrito, pero el reparto por apartados ha fallado. Tienes la transcripción abajo para escribir el acta a mano o volver a intentarlo."
        : "El reparto por apartados ha fallado. Tus notas siguen aquí: vuelve a intentarlo o escribe el acta a mano.",
    });
  }
});
