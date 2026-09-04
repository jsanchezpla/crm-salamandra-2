import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { apartadosPara } from "../../../../../../lib/clinica/plantillas.js";
import { materialParaLaIA, MAX_NOTAS, MAX_TRANSCRIPCION } from "../../../../../../lib/clinica/registroCompleto.js";
import { bloquesDelInforme } from "../../../../../../lib/clinica/informeMaterial.js";
import { structureInforme } from "../../../../../../lib/clinica/structureInforme.js";

/**
 * POST /api/clinica/reports/[id]/desde-material — el informe DICTADO
 * (04/09/2026, Rodrigo: la pantalla de crear un informe tiene que ser como la
 * del registro, «con su IA, sus notas y sus campos»).
 *
 * Recibe el material —lo que Whisper sacó de los audios, lo que la profesional
 * haya pegado del bloc de notas, o las dos cosas— y devuelve el informe entero
 * PROPUESTO, repartido por los apartados que tiene ese informe. **No guarda
 * nada**: la propuesta se enseña al lado de lo escrito y ella decide apartado
 * por apartado, igual que en el registro y por la misma razón — un informe
 * clínico lo firma una persona.
 *
 * ── POR QUÉ AQUÍ NO SE TRANSCRIBE ─────────────────────────────────────────
 * Los audios se mandan antes a `/api/clinica/audio/transcribir`, que es lo que
 * quita la espera de Whisper de delante del botón de la IA (04/09/2026). Aquí
 * entra ya el texto: ni se sube un fichero dos veces ni hace falta la clave de
 * OpenAI para escribir un informe a partir de notas.
 *
 * Campos del multipart (hace falta `transcripcion` **o** `texto`):
 *   · `transcripcion` (opcional) lo que sacó Whisper de los audios.
 *   · `texto`         (opcional) lo apuntado a mano; máx. MAX_NOTAS.
 *   · `apartados`     (opcional, JSON) los del informe tal como se están
 *                     viendo, que es lo que sabe la PANTALLA: la plantilla
 *                     elegida más los sueltos añadidos a mano. Sin ellos se
 *                     usan los del informe guardado.
 *   · `escrito`       (opcional, JSON) lo ya tecleado, como contexto para que
 *                     la propuesta no contradiga a la profesional.
 *
 * Devuelve `{ propuesta, nuevos, bloques, material }`. `nuevos` son apartados
 * que el modelo propone CREAR porque lo dictado no cabía en ninguno de los del
 * informe (`lib/clinica/apartadosPropuestos.js`).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export const POST = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // La demo es pública (sesión de admin anónima): nunca llamar a Claude con la
  // clave del tenant desde ahí. Va FUERA del try: lanza un `ForbiddenError` que
  // tiene que subir hasta `withTenant` para salir como 403 y no como un 500 del
  // `serverError` de abajo.
  assertNotDemoPaidCall(ctx, "La redacción con IA");

  try {
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport, Patient } = ctx.tenantModels;
    // Del paciente se traen los campos con los que `lineaDePaciente` monta el
    // contexto del prompt —edad, áreas, nivel educativo, tipo de atención—. El
    // NOMBRE no se pide: no viaja al modelo (`lib/clinica/estiloClinico.js`).
    const informe = await ClinicalReport.findByPk(id, {
      include: [
        {
          model: Patient,
          as: "patient",
          attributes: ["id", "age", "birthDate", "specialties", "educationLevel", "careType"],
        },
      ],
    });
    if (!informe) return notFound("Informe no encontrado");
    if (informe.status === "delivered") {
      // Reescribir un informe ya entregado dejaría a la familia con un PDF que
      // no coincide con lo que hay en el CRM.
      return error("Este informe ya se envió a la familia: duplícalo o crea uno nuevo para reescribirlo", 409);
    }

    const veto = await vetoAi(ctx, request, "redactar un informe clínico");
    if (veto) return veto;

    let form = null;
    try {
      form = await request.formData();
    } catch {
      form = null;
    }
    const notas = String(form?.get("texto") ?? "").trim();
    const transcripcion = String(form?.get("transcripcion") ?? "").trim();
    if (!notas && !transcripcion) return error("Dicta un audio o pega tus notas para el informe.");
    if (notas.length > MAX_NOTAS) {
      return error(`Las notas no pueden pasar de ${MAX_NOTAS.toLocaleString("es-ES")} caracteres.`, 413);
    }
    if (transcripcion.length > MAX_TRANSCRIPCION) {
      return error("La transcripción es demasiado larga para volver a procesarla.", 413);
    }

    const anthropicKey = getTenantAnthropicKey(ctx);
    if (!anthropicKey) {
      return error("Configura la clave de Anthropic en Configuración → IA para redactar el informe.", 503);
    }

    // Con qué apartados se está escribiendo: los que manda la pantalla (sabe la
    // plantilla elegida y los sueltos añadidos a mano) y, si no manda ninguno,
    // los del informe guardado — la MISMA función que usan el PDF y el listado.
    const cs = informe.contentSections && typeof informe.contentSections === "object" ? informe.contentSections : {};
    const apartados = jsonDelForm(form, "apartados") ?? apartadosPara(cs, ctx.tenant, "informe");
    const escrito = jsonDelForm(form, "escrito");
    const material = materialParaLaIA({ transcripcion, notas });

    let salida;
    const t0 = Date.now();
    try {
      salida = await structureInforme({
        transcription: material,
        apartados,
        escrito,
        paciente: informe.patient,
        tipo: informe.reportType,
        apiKey: anthropicKey,
        model: getTenantAnthropicModel(ctx),
      });
      console.info("[clinica:informe-material] claude", `${Date.now() - t0}ms`, `${material.length} chars`);
    } catch (e) {
      if (e?.code === "NO_API_KEY") return error("El informe con IA no está configurado (falta la clave de Anthropic).", 503);
      console.error("[clinica:informe-material]", e);
      // El material sigue en pantalla: se puede volver a intentar sin perder
      // nada, que es lo que hay que decir en vez de «ha fallado».
      return error("La IA no ha podido repartir esto por los apartados del informe. Vuelve a intentarlo: tu texto sigue aquí.", 502);
    }

    // Se audita QUÉ se propuso, nunca su texto: el contenido de un informe
    // clínico no se duplica en master.audit_logs.
    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.report.dictated",
      entity: "ClinicalReport",
      entityId: id,
      after: {
        apartados: Object.keys(salida.propuesta ?? {}).length,
        nuevos: (salida.nuevos ?? []).length,
        deAudio: Boolean(transcripcion),
        deNotas: Boolean(notas),
      },
      ip: request.headers.get("x-forwarded-for"),
    });

    // Lo que le pasó a la respuesta de Claude, dicho en cristiano: una
    // respuesta cortada no puede llegar a pantalla como «no ha sacado nada».
    const aviso =
      salida.incidencia === "cortada"
        ? "La IA se ha quedado sin sitio antes de terminar: tienes lo que llegó entero. Revisa si falta algún apartado y, si falta, vuelve a procesar."
        : salida.incidencia === "ilegible" || salida.incidencia === "vacia"
          ? "La IA ha contestado en un formato que no se ha podido leer. Vuelve a procesar: no hay que volver a subir el audio."
          : null;

    return ok({
      propuesta: salida.propuesta,
      nuevos: salida.nuevos,
      bloques: salida.bloques ?? bloquesDelInforme(apartados),
      material,
      ...(aviso ? { avisoIA: aviso } : {}),
    });
  } catch (err) {
    return serverError(err);
  }
});
