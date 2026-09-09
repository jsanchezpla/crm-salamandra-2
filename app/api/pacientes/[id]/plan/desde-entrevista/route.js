import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { esEntrevistaInicial } from "@/lib/clinica/entrevistaInicial.js";
import { aFormulario, apartadosPara, valoresDeSesion } from "@/lib/clinica/plantillas.js";
import { loQueRellena, resumenDelVolcado, volcadoDeEntrevista } from "@/lib/clinica/planDesdeEntrevista.js";

/**
 * GET /api/pacientes/[id]/plan/desde-entrevista — lo que el Plan puede
 * rellenar con lo que ya está escrito en la entrevista inicial del paciente
 * (09/09/2026, AV-0103 de Silvia).
 *
 * ── POR QUÉ NO GASTA IA ────────────────────────────────────────────────────
 * Se pidió «el botón de la IA en el Plan para que se rellenen diagnóstico,
 * motivo de consulta e información previa». Pero no hay nada que redactar: el
 * motivo y los antecedentes están escritos palabra por palabra en la
 * entrevista. Traerlos no cuesta un céntimo de la cuenta del centro, no puede
 * inventarse nada y sale igual siempre.
 *
 * ── NO ESCRIBE ─────────────────────────────────────────────────────────────
 * Devuelve lo que rellenaría y se acaba su trabajo. Quien decide es quien mira
 * la pantalla, y lo que acepte se guarda por el «Guardar plan» de siempre. Un
 * endpoint que escribiera en el plan al pulsar un botón podría pisar en un clic
 * el texto de una colegiada.
 *
 * El diagnóstico NO se rellena, y el motivo va explicado en la respuesta:
 * `lib/clinica/planDesdeEntrevista.js`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { ClinicSession, InterventionPlan, Patient } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id"] });
    if (!paciente) return notFound("Paciente no encontrado");

    /*
     * Su entrevista inicial. Lista blanca de columnas: lo que NO se pide, y no
     * es un olvido, es `ai_transcription` (la entrevista entera en crudo, con
     * todo lo que se dijo), `internal_notes` y `prep_text`. Misma frontera que
     * el PDF y que el correo del registro.
     */
    const filas = await ClinicSession.findAll({
      where: { patientId: id },
      attributes: ["id", "sessionDate", "contentSections", "objectives", "activities", "performance", "observations"],
      order: [["sessionDate", "ASC"]],
      limit: 50,
    });
    const entrevista = filas.map((f) => (f.toJSON ? f.toJSON() : f)).find(esEntrevistaInicial);
    if (!entrevista) {
      return ok({ hayEntrevista: false, rellena: {}, resumen: null });
    }

    const apartados = apartadosPara(entrevista.contentSections, ctx.tenant, "registro");
    const valores = aFormulario(valoresDeSesion(entrevista), apartados);
    const volcado = volcadoDeEntrevista(valores, apartados);

    const plan = InterventionPlan
      ? await InterventionPlan.findOne({ where: { patientId: id }, attributes: ["consultationReasons", "previousInfo", "diagnosis"] }).catch(() => null)
      : null;
    const rellena = loQueRellena(plan ?? {}, volcado);

    return ok({
      hayEntrevista: true,
      fecha: entrevista.sessionDate,
      rellena,
      resumen: resumenDelVolcado(rellena, plan ?? {}),
    });
  } catch (err) {
    return serverError(err);
  }
});
