import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  emailValido,
  exigirEditable,
  exigirMailing,
  idDeRuta,
  leerBody,
  serializarCampana,
  texto,
  UUID_RE,
} from "../../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../../lib/mailing/bloques.js";
import { campanaLista } from "../../../../../lib/mailing/envio.js";
import { NotFoundError } from "../../../../../lib/utils/errors.js";

/**
 * /api/mailing/campanas/[id] — una campaña.
 *
 * GET  la campaña entera (bloques incluidos) y si está lista para salir.
 * PATCH edita nombre, asunto, preheader, bloques, audiencia y reply-to. Solo
 *       mientras se pueda (borrador, programada, pausada, cancelada): una
 *       campaña enviada no cambia, se duplica. Los bloques se sanean al
 *       guardar (lista blanca de `lib/mailing/bloques.js`).
 * DELETE borra la campaña y, en cascada, sus envíos y eventos. Una campaña
 *       `enviando` no se borra: se pausa o se cancela antes.
 */
async function campanaDe(ctx, rc) {
  const id = await idDeRuta(rc);
  const { MailingCampaign, MailingSegment } = ctx.tenantModels;
  const campana = await MailingCampaign.findByPk(id, {
    include: [{ model: MailingSegment, as: "segment", attributes: ["id", "nombre"], required: false }],
  });
  if (!campana) throw new NotFoundError("Esa campaña ya no existe");
  return campana;
}

export const GET = withTenant(async (_request, rc, ctx) => {
  exigirMailing(ctx);
  const campana = await campanaDe(ctx, rc);
  return ok({ campana: serializarCampana(campana, { lista: campanaLista(campana) }) });
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const campana = await campanaDe(ctx, rc);
  exigirEditable(campana);
  const body = await leerBody(request);
  const { MailingSegment } = ctx.tenantModels;

  const cambios = {};
  if ("nombre" in body) cambios.nombre = texto(body.nombre, 160, { requerido: true, nombre: "El nombre de la campaña" });
  if ("asunto" in body) cambios.asunto = texto(body.asunto, 200);
  if ("preheader" in body) cambios.preheader = texto(body.preheader, 200);
  if ("bloques" in body) cambios.bloques = normalizarBloques(body.bloques);
  if ("replyTo" in body) cambios.replyTo = body.replyTo ? emailValido(body.replyTo, "El correo de respuesta") : null;
  if ("audiencia" in body || "segmentId" in body) {
    const audiencia = body.audiencia ?? campana.audiencia;
    if (audiencia === "segmento") {
      const segmentId = body.segmentId ?? campana.segmentId;
      if (!UUID_RE.test(String(segmentId ?? ""))) throw new ValidationError("Elige un segmento");
      if (!(await MailingSegment.findByPk(segmentId))) throw new ValidationError("Ese segmento ya no existe");
      cambios.audiencia = "segmento";
      cambios.segmentId = segmentId;
    } else {
      cambios.audiencia = "todos";
      cambios.segmentId = null;
    }
  }
  // Editar una campaña cancelada la devuelve a borrador: es lo que se espera
  // al retomarla.
  if (campana.estado === "cancelada") cambios.estado = "borrador";
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");

  await campana.update(cambios);
  await campana.reload();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.updated",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre, campos: Object.keys(cambios) },
  });
  return ok({ campana: serializarCampana(campana, { lista: campanaLista(campana) }) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const campana = await campanaDe(ctx, rc);
  if (campana.estado === "enviando") throw new ValidationError("Se está enviando: páusala o cancélala antes de borrarla");
  const resumen = { nombre: campana.nombre, estado: campana.estado, enviados: campana.enviados };
  const id = campana.id;
  await campana.destroy();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.deleted",
    entity: "mailing_campaign",
    entityId: id,
    before: resumen,
  });
  return ok({ borrado: true });
});
