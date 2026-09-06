import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarCampana } from "../../../../../../lib/mailing/comun.js";
import { recalcularContadores } from "../../../../../../lib/mailing/envio.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";

/**
 * POST /api/mailing/campanas/[id]/estado — { accion: "pausar" | "reanudar" | "cancelar" }.
 *
 *   pausar    enviando → pausada. Lo que está en vuelo termina; lo pendiente
 *             espera. Nadie recibe dos veces al reanudar (UNIQUE).
 *   reanudar  pausada → enviando. La pantalla y el temporizador siguen.
 *   cancelar  borrador/programada/pausada → cancelada. Lo pendiente no sale.
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  const { accion } = await leerBody(request);

  if (accion === "pausar") {
    if (campana.estado !== "enviando") throw new ValidationError("Solo se pausa una campaña que se está enviando");
    await campana.update({ estado: "pausada" });
  } else if (accion === "reanudar") {
    assertNotDemoPaidCall(ctx, "El envío de campañas");
    if (campana.estado !== "pausada") throw new ValidationError("Solo se reanuda una campaña pausada");
    await campana.update({ estado: "enviando", ultimoError: null });
  } else if (accion === "cancelar") {
    if (!["borrador", "programada", "pausada"].includes(campana.estado)) {
      throw new ValidationError(campana.estado === "enviando" ? "Páusala primero" : "Ya no se puede cancelar");
    }
    await campana.update({ estado: "cancelada", programadaPara: null });
  } else {
    throw new ValidationError("Acción desconocida");
  }

  await recalcularContadores(ctx, campana);
  await campana.reload();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: `mailing.campana.${accion === "pausar" ? "pausada" : accion === "reanudar" ? "reanudada" : "cancelada"}`,
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre, enviados: campana.enviados, pendientes: campana.totalDestinatarios - campana.enviados - campana.fallidos - campana.suprimidos },
  });
  return ok({ campana: serializarCampana(campana) });
});
