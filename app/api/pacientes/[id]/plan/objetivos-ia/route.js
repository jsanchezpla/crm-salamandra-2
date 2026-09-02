import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { esErrorDeIa, mensajeDeErrorIa } from "../../../../../../lib/ai/errorLegible.js";
import { complete } from "../../../../../../lib/outreach/analysis/anthropic.js";
import {
  MAX_IDEAS,
  promptObjetivos,
  parsearObjetivos,
  objetivosDeEnsayo,
} from "../../../../../../lib/clinica/objetivosIa.js";

/**
 * POST /api/pacientes/[id]/plan/objetivos-ia ⚡ Claude
 *
 * De unas ideas clave a los objetivos de intervención del plan (02/09/2026,
 * Aumenta por el buzón AV-0019, Laura). NO guarda nada: devuelve una
 * propuesta y es la terapeuta quien elige cuáles entran en el plan y pulsa
 * «Guardar plan». Misma cadena que el resto de la IA clínica: clave y modelo
 * del TENANT (BYOK), `vetoAi` por persona, la demo en modo simulado.
 *
 * Body: { ideas: string, plan?: { diagnosis, consultationReasons, previousInfo, objectives } }
 * `plan` es lo que hay EN PANTALLA (puede no estar guardado aún); si no viene,
 * se lee el guardado. Del paciente al modelo solo viaja lo que deja pasar
 * `contextoDelPaciente` (edad, especialidades, nivel): nunca su nombre.
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

    const veto = await vetoAi(ctx, request, "redactar objetivos del plan con IA");
    if (veto) return veto;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }
    const ideas = typeof body.ideas === "string" ? body.ideas.trim().slice(0, MAX_IDEAS) : "";
    if (ideas.length < 3) return error("Escribe alguna idea clave (al menos 3 caracteres) para redactar los objetivos", 422);

    const { Patient, InterventionPlan } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, {
      attributes: ["id", "birthDate", "age", "specialties", "educationLevel", "careType"],
    });
    if (!paciente) return notFound("Paciente no encontrado");

    let plan = body.plan && typeof body.plan === "object" ? body.plan : null;
    if (!plan && InterventionPlan) {
      const guardado = await InterventionPlan.findOne({ where: { patientId: id } });
      plan = guardado ? guardado.toJSON() : {};
    }
    plan = plan ?? {};
    const yaTiene = Array.isArray(plan.objectives) ? plan.objectives.filter((o) => typeof o === "string") : [];

    if (demoForcesFakeAi(ctx)) {
      return ok({ objetivos: objetivosDeEnsayo(ideas), fake: true });
    }

    const apiKey = getTenantAnthropicKey(ctx);
    const model = getTenantAnthropicModel(ctx);
    const { system, user } = promptObjetivos({ ideas, plan, paciente: paciente.toJSON() });
    const respuesta = await complete({ system, user, model, maxTokens: 1500, apiKey });

    const objetivos = parsearObjetivos(respuesta, { yaTiene });
    if (!objetivos.length) return error("La IA no ha devuelto objetivos válidos. Inténtalo de nuevo con otras ideas.", 502);

    return ok({ objetivos, fake: false });
  } catch (err) {
    if (err?.code === "NO_API_KEY") {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }
    if (esErrorDeIa(err)) return error(mensajeDeErrorIa(err), 502);
    return serverError(err);
  }
});
