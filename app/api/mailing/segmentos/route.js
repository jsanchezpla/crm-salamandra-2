import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { autorDe, exigirMailing, leerBody, serializarSegmento, texto } from "../../../../lib/mailing/comun.js";
import { normalizarReglas } from "../../../../lib/mailing/audiencia.js";

/**
 * /api/mailing/segmentos — los grupos de destinatarios definidos por reglas.
 *
 * GET lista; POST crea. Las reglas se normalizan al guardar
 * (`lib/mailing/audiencia.js`): lo que no se entiende no se guarda, así que
 * un segmento nunca lleva una regla que el envío ignore en silencio.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  exigirMailing(ctx);
  const { MailingSegment } = ctx.tenantModels;
  const filas = await MailingSegment.findAll({ order: [["nombre", "ASC"]] });
  return ok({ segmentos: filas.map((s) => serializarSegmento(s)) });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const nombre = texto(body.nombre, 120, { requerido: true, nombre: "El nombre del segmento" });
  const { MailingSegment } = ctx.tenantModels;
  const segmento = await MailingSegment.create({
    nombre,
    descripcion: texto(body.descripcion, 1000),
    reglas: normalizarReglas(body.reglas),
    createdBy: autorDe(request),
  });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.segmento.created",
    entity: "mailing_segment",
    entityId: segmento.id,
    after: { nombre: segmento.nombre },
  });
  return ok({ segmento: serializarSegmento(segmento) });
});
