import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarSegmento, texto } from "../../../../../lib/mailing/comun.js";
import { contarAudiencia, normalizarReglas } from "../../../../../lib/mailing/audiencia.js";

/** GET (con recuento), PATCH y DELETE de un segmento. */
export const GET = withTenant(async (_request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const segmento = await buscarOFallar(ctx.tenantModels.MailingSegment, id, "Ese segmento");
  const audiencia = await contarAudiencia(ctx, segmento.reglas, { conClientes: ctx.tenantHasModule("clients") });
  return ok({ segmento: serializarSegmento(segmento, { audiencia }) });
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const segmento = await buscarOFallar(ctx.tenantModels.MailingSegment, id, "Ese segmento");
  const body = await leerBody(request);
  const cambios = {};
  if ("nombre" in body) cambios.nombre = texto(body.nombre, 120, { requerido: true, nombre: "El nombre del segmento" });
  if ("descripcion" in body) cambios.descripcion = texto(body.descripcion, 1000);
  if ("reglas" in body) cambios.reglas = normalizarReglas(body.reglas);
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");
  const antes = { nombre: segmento.nombre };
  await segmento.update(cambios);
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.segmento.updated",
    entity: "mailing_segment",
    entityId: segmento.id,
    before: antes,
    after: { nombre: segmento.nombre, campos: Object.keys(cambios) },
  });
  return ok({ segmento: serializarSegmento(segmento) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const { MailingSegment, MailingCampaign } = ctx.tenantModels;
  const segmento = await buscarOFallar(MailingSegment, id, "Ese segmento");
  const enUso = await MailingCampaign.count({ where: { segmentId: id, estado: ["borrador", "programada", "enviando", "pausada"] } });
  if (enUso) throw new ValidationError(`Lo usan ${enUso} campaña(s) sin enviar: cámbialas de audiencia antes de borrarlo`);
  const nombre = segmento.nombre;
  await segmento.destroy();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.segmento.deleted",
    entity: "mailing_segment",
    entityId: id,
    before: { nombre },
  });
  return ok({ borrado: true });
});
