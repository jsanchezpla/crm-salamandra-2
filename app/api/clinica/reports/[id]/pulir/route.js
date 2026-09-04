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
 * Del informe se le pasan al modelo los cinco apartados que salen del volcado.
 * El motivo de intervención no se manda en ningún sentido: lo escribe ella y de
 * las sesiones no se deduce. Desde el 04/09/2026 sí se le piden los apartados
 * de síntesis que están VACÍOS —logros, recomendaciones, propuesta de
 * continuidad—, que son los que hasta ahora se quedaban en blanco siempre; lo
 * que ella haya escrito en ellos no se toca (ver `lib/clinica/pulirInforme.js`).
 *
 * Al modelo viaja también la edad y las áreas del paciente —lista cerrada, sin
 * nombres (`lineaDePaciente`)—: sin la edad, el mismo párrafo vale para un niño
 * de 5 años y para uno de 15, que era una de las razones por las que lo que
 * salía sonaba genérico.
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

    const { ClinicalReport, Patient } = ctx.tenantModels;
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

    // Solo para el prompt, y solo lo que deja pasar `lineaDePaciente`: edad,
    // áreas, nivel educativo y tipo de atención. Si el paciente ya no está (o
    // el informe es viejo), se redacta sin contexto como hasta ahora.
    const paciente = esFake ? null : await Patient.findByPk(informe.patientId).catch(() => null);

    const { propuesta, avisos } = esFake
      ? fakePulirInforme({ contentSections: cs })
      : await pulirInforme({ contentSections: cs, paciente, apiKey, model: getTenantAnthropicModel(ctx) });

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
