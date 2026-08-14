import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { pulirInforme, fakePulirInforme } from "../../../../../../lib/clinica/pulirInforme.js";

/**
 * POST /api/clinica/reports/[id]/pulir — la redacción asistida del informe.
 *
 * Es el paso de DESPUÉS de `desde-sesiones`: aquel vuelca las anotaciones de
 * las sesiones literales, con su fecha delante; este las redacta.
 *
 * ⚠️ NO GUARDA NADA, y eso es el diseño, no una fase pendiente. Devuelve
 * `{ propuesta, avisos }` y la profesional la ve al lado de lo suyo y decide
 * apartado por apartado. Un informe clínico lo firma una persona: el día que
 * este endpoint escriba solo en la base de datos, lo que la familia recibe
 * habrá dejado de ser lo que ella escribió.
 *
 * Del informe solo se le pasan al modelo los cinco apartados que salen del
 * volcado. El motivo de intervención y la propuesta de continuidad los escribe
 * ella y ni siquiera se mandan (ver `lib/clinica/pulirInforme.js`).
 *
 * Clave BYOK del tenant; sin clave → 503. En la DEMO, simulado.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport } = ctx.tenantModels;
    const informe = await ClinicalReport.findByPk(id);
    if (!informe) return notFound("Informe no encontrado");
    if (informe.status === "delivered") {
      return error("Este informe ya se envió a la familia: duplícalo o crea uno nuevo para reescribirlo", 409);
    }

    const veto = await vetoAi(ctx, request, "redactar un informe clínico");
    if (veto) return veto;

    const esFake = demoForcesFakeAi(ctx);
    const apiKey = esFake ? null : getTenantAnthropicKey(ctx);
    if (!esFake && !apiKey) {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }

    const cs = informe.contentSections && typeof informe.contentSections === "object" ? informe.contentSections : {};

    const { propuesta, avisos } = esFake
      ? fakePulirInforme({ contentSections: cs })
      : await pulirInforme({ contentSections: cs, apiKey, model: getTenantAnthropicModel(ctx) });

    // Se audita QUÉ apartados se propusieron, nunca su texto: el contenido de un
    // informe clínico no se duplica en master.audit_logs.
    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.report.polished",
      entity: "ClinicalReport",
      entityId: id,
      after: { apartados: Object.keys(propuesta), simulado: esFake, avisos: avisos.length },
      ip: request.headers.get("x-forwarded-for"),
    });

    return ok({ propuesta, avisos, simulado: esFake });
  } catch (err) {
    if (err?.code === "NO_API_KEY") {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }
    if (err?.code === "SIN_CONTENIDO") return error(err.message, 422);
    // La IA que inventa o que no se entiende es un 502: el fallo es del
    // proveedor, no de quien pulsó el botón, y el mensaje dice exactamente qué
    // se le ha descartado para que no se quede pensando que no hizo nada.
    if (err?.code === "IA_INVENTA" || err?.code === "IA_ILEGIBLE") return error(err.message, 502);
    return serverError(err);
  }
});
