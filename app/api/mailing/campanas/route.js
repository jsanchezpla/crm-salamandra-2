import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { autorDe, emailValido, exigirMailing, leerBody, serializarCampana, texto, UUID_RE } from "../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../lib/mailing/bloques.js";

/**
 * /api/mailing/campanas — las campañas del centro.
 *
 * GET lista (con sus contadores y el nombre del segmento).
 * POST crea un borrador: con nombre y, si se quiere, a partir de una plantilla
 * guardada (`plantillaId`) o de una campaña anterior (`desdeCampanaId`), que
 * copia asunto, preheader y bloques. Los bloques se normalizan al entrar.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  exigirMailing(ctx);
  const { MailingCampaign, MailingSegment } = ctx.tenantModels;
  // Las campañas AUTOMÁTICAS de las secuencias (tipo "secuencia") viven en su
  // pantalla; aquí saldrían como una campaña «Cumpleaños · 2026» sin botón.
  const filas = await MailingCampaign.findAll({
    where: { tipo: "campana" },
    include: [{ model: MailingSegment, as: "segment", attributes: ["id", "nombre"], required: false }],
    order: [["updatedAt", "DESC"]],
    limit: 300,
  });
  // La lista no necesita los bloques: pesan y no se pintan.
  return ok({ campanas: filas.map((c) => ({ ...serializarCampana(c), bloques: undefined, numBloques: (c.bloques ?? []).length })) });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const nombre = texto(body.nombre, 160, { requerido: true, nombre: "El nombre de la campaña" });
  const { MailingCampaign, MailingTemplate, MailingSegment } = ctx.tenantModels;

  let base = { asunto: texto(body.asunto, 200), preheader: texto(body.preheader, 200), bloques: normalizarBloques(body.bloques) };
  if (body.plantillaId) {
    if (!UUID_RE.test(String(body.plantillaId))) throw new ValidationError("Plantilla inválida");
    const p = await MailingTemplate.findByPk(body.plantillaId);
    if (!p) throw new ValidationError("Esa plantilla ya no existe");
    base = { asunto: p.asunto, preheader: p.preheader, bloques: normalizarBloques(p.bloques) };
  } else if (body.desdeCampanaId) {
    if (!UUID_RE.test(String(body.desdeCampanaId))) throw new ValidationError("Campaña inválida");
    const c = await MailingCampaign.findByPk(body.desdeCampanaId);
    if (!c) throw new ValidationError("Esa campaña ya no existe");
    base = { asunto: c.asunto, preheader: c.preheader, bloques: normalizarBloques(c.bloques) };
  }

  let segmentId = null;
  let audiencia = "todos";
  if (body.audiencia === "segmento") {
    if (!UUID_RE.test(String(body.segmentId ?? ""))) throw new ValidationError("Elige un segmento");
    if (!(await MailingSegment.findByPk(body.segmentId))) throw new ValidationError("Ese segmento ya no existe");
    segmentId = body.segmentId;
    audiencia = "segmento";
  }

  const campana = await MailingCampaign.create({
    nombre,
    ...base,
    audiencia,
    segmentId,
    replyTo: body.replyTo ? emailValido(body.replyTo, "El correo de respuesta") : null,
    estado: "borrador",
    createdBy: autorDe(request),
  });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.created",
    entity: "mailing_campaign",
    entityId: campana.id,
    after: { nombre: campana.nombre },
  });
  return ok({ campana: serializarCampana(campana) });
});
