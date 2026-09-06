import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { autorDe, buscarOFallar, exigirMailing, idDeRuta, serializarCampana } from "../../../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../../../lib/mailing/bloques.js";

/** POST /api/mailing/campanas/[id]/duplicar — un borrador nuevo con el mismo contenido y audiencia. */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const { MailingCampaign } = ctx.tenantModels;
  const origen = await buscarOFallar(MailingCampaign, id, "Esa campaña");
  const copia = await MailingCampaign.create({
    nombre: `${origen.nombre} (copia)`.slice(0, 160),
    asunto: origen.asunto,
    preheader: origen.preheader,
    bloques: normalizarBloques(origen.bloques),
    audiencia: origen.audiencia,
    segmentId: origen.segmentId,
    replyTo: origen.replyTo,
    estado: "borrador",
    createdBy: autorDe(request),
  });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.campana.created",
    entity: "mailing_campaign",
    entityId: copia.id,
    after: { nombre: copia.nombre, duplicadaDe: origen.id },
  });
  return ok({ campana: serializarCampana(copia) });
});
