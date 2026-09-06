import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { buscarOFallar, exigirMailing, idDeRuta, serializarCampana } from "../../../../../../lib/mailing/comun.js";
import { avanzarCampana } from "../../../../../../lib/mailing/envio.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { urlBase } from "../../../../../../lib/mailing/enlaces.js";

/**
 * POST /api/mailing/campanas/[id]/avanzar — mandar el siguiente lote de una
 * campaña que está `enviando`. La pantalla lo llama en bucle mientras la
 * campaña avanza; el temporizador del VPS hace lo mismo por su cuenta, y los
 * dos pueden coincidir sin duplicar (FOR UPDATE SKIP LOCKED).
 *
 * Si la campaña ya no está enviando (terminó, la pausaron), no hace nada y
 * devuelve su estado.
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  assertNotDemoPaidCall(ctx, "El envío de campañas");
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  if (campana.estado !== "enviando") return ok({ campana: serializarCampana(campana), lote: null });
  const lote = await avanzarCampana(ctx, campana, { lote: 10, base: urlBase(request), presupuestoMs: 8000 });
  await campana.reload();
  return ok({ campana: serializarCampana(campana), lote });
});
