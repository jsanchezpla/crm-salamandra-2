import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { exigirMailing, UUID_RE } from "../../../../lib/mailing/comun.js";
import { puedeAvisar, yaRespondio } from "../../../../lib/clients/comunicaciones.js";
import { normalizarEmail } from "../../../../lib/mailing/bajaToken.js";

/**
 * GET /api/mailing/historial?clientId=… — qué campañas ha recibido una ficha,
 * si las abrió y si pinchó (sprint 2: «historial en la ficha, al lado del hilo
 * de WhatsApp»). También dice si hoy puede recibir (casilla y supresión).
 *
 * Se casa por `origen_id` (la ficha de la que salió el envío) Y por el correo
 * actual de la ficha, para no perder lo que se le mandó antes de un cambio de
 * correo ni lo que le llegó como correo suelto antes de ser cliente.
 *
 * Misma puerta que el módulo (`mailing`): la pestaña de la ficha se esconde
 * sola cuando el endpoint contesta 403.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!UUID_RE.test(clientId)) throw new ValidationError("clientId inválido");
  const { Client, MailingSend, MailingCampaign, MailingSequence, MailingSuppression } = ctx.tenantModels;

  const cliente = Client ? await Client.findByPk(clientId, { attributes: ["id", "email", "communicationPrefs"] }) : null;
  const email = normalizarEmail(cliente?.email);
  const o = [{ origenId: clientId }];
  if (email) o.push({ email });

  const envios = await MailingSend.findAll({
    where: { [Op.or]: o, origen: { [Op.ne]: "prueba" } },
    include: [
      {
        model: MailingCampaign,
        as: "campaign",
        attributes: ["id", "nombre", "asunto", "asuntoB", "tipo", "sequenceId", "periodo"],
        include: [{ model: MailingSequence, as: "sequence", attributes: ["id", "nombre", "evento"], required: false }],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit: 100,
  });

  const suprimido = email ? await MailingSuppression.findOne({ where: { email }, attributes: ["motivo", "createdAt"] }) : null;

  return ok({
    consentimiento: cliente
      ? { casilla: puedeAvisar(cliente, "novedades"), respondio: yaRespondio(cliente), email: cliente.email ?? null }
      : null,
    supresion: suprimido ? { motivo: suprimido.motivo, desde: suprimido.createdAt } : null,
    envios: envios.map((e) => ({
      id: e.id,
      estado: e.estado,
      variante: e.variante,
      asunto: e.variante === "b" && e.campaign?.asuntoB ? e.campaign.asuntoB : e.campaign?.asunto ?? null,
      campana: e.campaign ? { id: e.campaign.id, nombre: e.campaign.nombre, tipo: e.campaign.tipo } : null,
      secuencia: e.campaign?.sequence ? { id: e.campaign.sequence.id, nombre: e.campaign.sequence.nombre, evento: e.campaign.sequence.evento } : null,
      enviadoAt: e.enviadoAt,
      abiertoAt: e.abiertoAt,
      aperturas: e.aperturas,
      clics: e.clics,
      primerClicAt: e.primerClicAt,
      error: e.error,
    })),
  });
});
