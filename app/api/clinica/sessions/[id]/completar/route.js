import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "@/lib/demo/isDemo.js";
import { vetoAi } from "@/lib/ai/aiAccess.js";
import { getTenantAnthropicKey } from "@/lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "@/lib/ai/anthropicModel.js";
import { structureSession } from "@/lib/clinica/structureSession.js";
import { apartadosPara, aFormulario, valoresDeSesion } from "@/lib/clinica/plantillas.js";
import {
  bloquesDelRegistro,
  CLAVES_ENVOLTORIO,
  materialParaLaIA,
  MAX_NOTAS,
  propuestaDemo,
  propuestaVacia,
} from "@/lib/clinica/registroCompleto.js";

/**
 * POST /api/clinica/sessions/[id]/completar — rehacer el registro ENTERO de una
 * sesión YA GUARDADA a partir de su texto (01/09/2026, Rodrigo).
 *
 * Body opcional: `{ texto }` con lo que se haya apuntado a mano. Se SUMA a la
 * transcripción guardada si la hay, y la sustituye si no —que es el caso de las
 * 22.045 sesiones importadas de Aumenta, ninguna con audio—. Sin body y sin
 * transcripción, 409 con el motivo. Whisper no entra aquí por ningún lado.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 * Hasta hoy la transcripción solo se podía aprovechar EN EL MOMENTO: se subía
 * el audio en «Nuevo registro», Claude repartía lo que sabía repartir y ahí se
 * acababa. Si la sesión quedaba a medias —y quedaban a medias, porque el reparto
 * solo cubría siete apartados de los cuatro bloques del registro—, el texto
 * transcrito seguía guardado en `ai_transcription` y no había ninguna manera de
 * volver a pasarle Claude por encima. Había que releerlo y teclear.
 *
 * Esta ruta es esa segunda oportunidad, y por eso NO pide audio: la
 * transcripción ya está pagada y guardada. Whisper no se vuelve a llamar.
 *
 * ── NO GUARDA NADA, A PROPÓSITO ────────────────────────────────────────────
 * Devuelve la propuesta y se acaba su trabajo. Quien decide apartado por
 * apartado es la profesional, en el cajón de la ficha, y lo que elija se guarda
 * por el PATCH de siempre (`sessions/[id]`). Un endpoint de IA que escribiera
 * directo en una sesión firmada podría pisar en un clic el texto de una
 * colegiada — y encima sin registro de qué había antes.
 *
 * Respuesta: { propuesta, bloques, escrito, transcription, demo }.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    // La demo pública da sesión de ADMIN a visitantes anónimos: aquí se gasta
    // clave de Anthropic del tenant, así que se corta antes de llamar.
    assertNotDemoPaidCall(ctx, "Completar un registro con IA");

    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { ClinicSession, Patient } = ctx.tenantModels;
    const s = await ClinicSession.findByPk(id);
    if (!s) return notFound("Sesión no encontrada");

    // Las notas pegadas a mano, si vienen. El body es opcional: sin él se usa
    // la transcripción guardada y ya está.
    let notas = "";
    try {
      const body = await request.json();
      notas = String(body?.texto ?? "").trim();
    } catch {
      notas = "";
    }
    if (notas.length > MAX_NOTAS) {
      return error(`Las notas no pueden pasar de ${MAX_NOTAS.toLocaleString("es-ES")} caracteres.`, 413);
    }

    const transcription = String(s.aiTranscription ?? "").trim();
    // Las dos fuentes se suman: una sesión con audio a la que además se le
    // pegan cuatro apuntes se aprovecha entera. Whisper NO se llama: aquí no
    // entra un audio por ningún lado.
    const material = materialParaLaIA({ transcripcion: transcription, notas });
    if (!material) {
      // 409 y no 400: la petición es correcta, lo que pasa es que esta sesión
      // no tiene de dónde salir. El mensaje dice dónde se arregla, como el de
      // «enviar sin pagador».
      return error(
        "Esta sesión no tiene texto del que sacar el registro: no guardó transcripción y no has pegado notas. Pega tus notas y vuelve a intentarlo.",
        409
      );
    }

    const veto = await vetoAi(ctx, request, "completar un registro clínico con IA");
    if (veto) return veto;

    // Mismo modo canned que `sessions/transcribe`, y por lo mismo: en local no
    // hay claves y sin esto la pantalla no se puede ni ver. LIMITADO a
    // desarrollo — en producción siempre se llama a Claude de verdad.
    const isDev = process.env.NODE_ENV !== "production";
    const anthropicKey = getTenantAnthropicKey(ctx);
    const fake = isDev && (process.env.CLINICA_FAKE_AI === "1" || !anthropicKey);
    if (!fake && !anthropicKey) {
      return error("Configura la clave de Anthropic en Configuración → IA para completar el registro.", 400);
    }

    // Con QUÉ apartados se escribió esta sesión: su propia foto si la tiene y,
    // si no (las 22.045 importadas de Aumenta no la tienen), la plantilla del
    // centro. Es la MISMA función que usan el cajón y el PDF, para que la
    // propuesta caiga exactamente en los apartados que se ven en pantalla.
    const apartados = apartadosPara(s.contentSections, ctx.tenant, "registro");
    const bloques = bloquesDelRegistro(apartados);

    // Lo que ya hay escrito, en la forma del formulario (una línea por viñeta):
    // viaja a Claude como contexto para que no lo contradiga, y vuelve a la
    // pantalla para poder enseñar «lo tuyo» al lado de «lo propuesto».
    const escrito = aFormulario(valoresDeSesion(s), apartados);
    for (const clave of CLAVES_ENVOLTORIO) escrito[clave] = String(s[clave] ?? "");

    if (fake) {
      return ok({ propuesta: propuestaDemo(bloques), nuevos: [], bloques, escrito, material, demo: true });
    }

    let propuesta;
    // Los apartados que el modelo propone CREAR porque lo dictado no cabía en
    // ninguno de los de esta sesión (04/09/2026). Viajan aparte de la propuesta.
    let nuevos = [];
    try {
      const r = await structureSession({
        transcription: material,
        apartados,
        escrito,
        // Edad y áreas del paciente para el prompt; su nombre no viaja nunca
        // (`lineaDePaciente`). Si la ficha ya no está, se redacta sin contexto.
        paciente: await Patient.findByPk(s.patientId).catch(() => null),
        apiKey: anthropicKey,
        model: getTenantAnthropicModel(ctx),
      });
      propuesta = r.propuesta;
      nuevos = r.nuevos ?? [];
    } catch (e) {
      if (e.code === "NO_API_KEY") return error("El resumen con IA no está configurado (falta la clave de Anthropic).", 503);
      console.error("[clinica:completar]", e);
      return error("La IA no ha podido repartir el texto de esta sesión. Inténtalo de nuevo.", 502);
    }

    if (propuestaVacia(propuesta) && nuevos.length === 0) {
      return error("La IA no ha sacado nada de este texto. Léelo y escribe el registro a mano.", 422);
    }

    return ok({ propuesta, nuevos, bloques, escrito, material, demo: false });
  } catch (err) {
    return serverError(err);
  }
});
