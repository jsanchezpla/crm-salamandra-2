import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, texto } from "../../../../../../lib/mailing/comun.js";
import { asuntosAlternativos, fakeAsuntos, fakeRedaccion, redactarConIa } from "../../../../../../lib/mailing/ia.js";
import { centroDe } from "../../../../../../lib/mailing/envio.js";
import { normalizarBloques } from "../../../../../../lib/mailing/bloques.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { vocabularioCliente } from "../../../../../../lib/clients/vocabulario.js";

/**
 * POST /api/mailing/campanas/[id]/ia — redactar con IA, SIEMPRE a petición
 * (botón). Clave BYOK del tenant; sin clave → 503. En la demo pública, modo
 * simulado sin API real (demoForcesFakeAi), como el resto del CRM.
 *
 * Body:
 *   { accion: "redactar", instruccion, tono?, imagenUrl? }
 *       → { propuesta: { asunto, preheader, bloques } }   (no se guarda: la
 *         pantalla la aplica al editor y el guardado automático la persiste)
 *   { accion: "asuntos" }
 *       → { asuntos: [...] }   tres alternativas para el A/B
 *
 * La IA rellena bloques del catálogo; nunca HTML libre (lib/mailing/ia.js).
 */
const TONOS = new Set(["cercano", "profesional", "entusiasta"]);

export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  const body = await leerBody(request);
  const accion = body.accion === "asuntos" ? "asuntos" : "redactar";

  const veto = await vetoAi(ctx, request, "IA de mailing (redactar campañas)");
  if (veto) return veto;

  const esFake = demoForcesFakeAi(ctx);
  const apiKey = esFake ? null : getTenantAnthropicKey(ctx);
  if (!esFake && !apiKey) throw new AppError("Este cliente no tiene configurada la clave de IA (Configuración → Conexiones → Anthropic)", 503);
  const model = getTenantAnthropicModel(ctx);
  const centro = centroDe(ctx);

  if (accion === "asuntos") {
    const asunto = texto(body.asunto ?? campana.asunto, 200);
    if (!asunto) throw new ValidationError("Escribe primero un asunto: la IA propone alternativas a partir de él");
    let asuntos;
    try {
      asuntos = esFake
        ? fakeAsuntos({ asunto })
        : await asuntosAlternativos({ centro, asunto, bloques: normalizarBloques(campana.bloques), apiKey, model });
    } catch (err) {
      if (err?.code === "NO_API_KEY") throw new AppError("Este cliente no tiene configurada la clave de IA", 503);
      throw new AppError(`La IA no ha respondido: ${err.message}`, 502);
    }
    if (!asuntos.length) throw new AppError("La IA no ha propuesto asuntos; prueba otra vez", 502);
    return ok({ asuntos });
  }

  const instruccion = texto(body.instruccion, 3000, { requerido: true, nombre: "La instrucción" });
  const imagenUrl = /^https?:\/\//i.test(String(body.imagenUrl ?? "")) ? String(body.imagenUrl).slice(0, 2000) : null;
  const tono = TONOS.has(body.tono) ? body.tono : "cercano";

  let propuesta;
  try {
    propuesta = esFake
      ? fakeRedaccion({ instruccion, imagenUrl })
      : await redactarConIa({
          centro,
          vocab: vocabularioCliente((k) => ctx.tenantHasModule(k)),
          instruccion,
          tono,
          imagenUrl,
          bloquesActuales: normalizarBloques(campana.bloques),
          apiKey,
          model,
        });
  } catch (err) {
    if (err?.code === "NO_API_KEY") throw new AppError("Este cliente no tiene configurada la clave de IA", 503);
    throw new AppError(`La IA no ha respondido: ${err.message}`, 502);
  }
  if (!propuesta) throw new AppError("La IA ha devuelto algo que no se entiende; prueba a reformular la instrucción", 502);

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.ia",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { simulado: esFake, bloques: propuesta.bloques.length, conImagen: !!imagenUrl, tono },
  });
  return ok({ propuesta, simulado: esFake });
});
