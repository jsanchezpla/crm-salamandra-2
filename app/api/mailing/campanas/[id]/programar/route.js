import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarCampana } from "../../../../../../lib/mailing/comun.js";
import { campanaLista, exigirSes } from "../../../../../../lib/mailing/envio.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";

/**
 * /api/mailing/campanas/[id]/programar — dejar la campaña para una fecha.
 *
 * POST { fecha }  la pone en `programada`; el temporizador del VPS la arranca
 *                 cuando llegue la hora (a lo sumo un minuto después).
 * DELETE          la devuelve a borrador.
 *
 * Se comprueba AHORA que está lista y que SES está configurado: descubrir a
 * las 9 de la mañana que faltaba el asunto es peor que no poder programarla.
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  assertNotDemoPaidCall(ctx, "La programación de campañas");
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  if (!["borrador", "programada", "pausada", "cancelada"].includes(campana.estado)) {
    throw new ValidationError("Esta campaña ya salió o está saliendo");
  }
  const body = await leerBody(request);
  const fecha = new Date(String(body.fecha ?? ""));
  if (Number.isNaN(fecha.getTime())) throw new ValidationError("Fecha inválida");
  if (fecha.getTime() < Date.now() + 60000) throw new ValidationError("La fecha tiene que ser al menos un minuto en el futuro. Para mandarla ya, usa «Enviar»");
  if (fecha.getTime() > Date.now() + 366 * 86400000) throw new ValidationError("Como mucho un año vista");
  const lista = campanaLista(campana);
  if (!lista.ok) throw new ValidationError(lista.motivo);
  exigirSes(ctx);

  await campana.update({ estado: "programada", programadaPara: fecha, ultimoError: null });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.programada",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre, programadaPara: fecha.toISOString() },
  });
  return ok({ campana: serializarCampana(campana) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const campana = await buscarOFallar(ctx.tenantModels.MailingCampaign, id, "Esa campaña");
  if (campana.estado !== "programada") throw new ValidationError("No está programada");
  await campana.update({ estado: "borrador", programadaPara: null });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.desprogramada",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre },
  });
  return ok({ campana: serializarCampana(campana) });
});
