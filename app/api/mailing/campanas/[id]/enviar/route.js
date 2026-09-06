import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, serializarCampana } from "../../../../../../lib/mailing/comun.js";
import { avanzarCampana, prepararCampana } from "../../../../../../lib/mailing/envio.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { urlBase } from "../../../../../../lib/mailing/enlaces.js";

/**
 * POST /api/mailing/campanas/[id]/enviar — arrancar el envío AHORA.
 *
 * Prepara las filas de `mailing_sends` (la audiencia se resuelve en este
 * momento), pone la campaña en `enviando` y manda un PRIMER lote pequeño en
 * la propia petición, para que quien pulsa vea salir algo. El resto lo va
 * pidiendo la pantalla (`/avanzar`) y, en producción, lo remata el
 * temporizador `scripts/enviar-mailing.js` aunque se cierre el navegador.
 *
 * Manda correo a mucha gente: guard de demo (la demo es pública y con sesión
 * de admin: un botón de envío masivo ahí es un regalo para un spammer).
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  assertNotDemoPaidCall(ctx, "El envío de campañas");
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  if (!["borrador", "programada", "pausada", "cancelada"].includes(campana.estado)) {
    throw new ValidationError(campana.estado === "enviando" ? "Ya se está enviando" : "Esta campaña ya salió: duplícala para volver a mandarla");
  }

  const preparacion = await prepararCampana(ctx, campana);
  const lote = await avanzarCampana(ctx, campana, { lote: 10, base: urlBase(request), presupuestoMs: 8000 });
  await campana.reload();

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.enviada",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre, asunto: campana.asunto, destinatarios: preparacion.total, audiencia: campana.audiencia },
  });
  return ok({ campana: serializarCampana(campana), preparacion, lote });
});
