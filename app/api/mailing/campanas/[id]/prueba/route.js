import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, emailValido, exigirMailing, idDeRuta, leerBody } from "../../../../../../lib/mailing/comun.js";
import { enviarPrueba } from "../../../../../../lib/mailing/envio.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { urlBase } from "../../../../../../lib/mailing/enlaces.js";

/**
 * POST /api/mailing/campanas/[id]/prueba — mandar la campaña tal cual está a
 * una o varias direcciones del equipo (hasta 5), con «[PRUEBA]» delante del
 * asunto. No crea filas ni mide nada. Manda correo: guard de demo.
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  assertNotDemoPaidCall(ctx, "El envío de prueba");
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  const body = await leerBody(request);
  const crudos = Array.isArray(body.emails) ? body.emails : [body.email];
  const emails = [...new Set(crudos.filter(Boolean).map((e) => emailValido(e, "Alguna dirección")))].slice(0, 5);
  if (!emails.length) throw new ValidationError("Di a qué dirección mandar la prueba");

  const resultados = await enviarPrueba(ctx, campana, emails, { base: urlBase(request) });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.prueba_enviada",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { destinatarios: emails.length, ok: resultados.filter((r) => r.ok).length },
  });
  return ok({ resultados });
});
