import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { buscarOFallar, exigirMailing, idDeRuta } from "../../../../../../lib/mailing/comun.js";

/**
 * GET /api/mailing/campanas/[id]/metricas — cómo fue.
 *
 * Clics como métrica principal; aperturas como dato ORIENTATIVO (plan,
 * entregable 8): Apple Mail y los filtros de spam «abren» los correos sin que
 * nadie los lea, así que la pantalla lo dice.
 *
 * Devuelve los recuentos por estado, personas únicas que abrieron/clicaron,
 * el detalle por enlace (qué se pinchó) y la lista de destinatarios con su
 * estado (hasta 1.000; `?q=` filtra por correo o nombre).
 */
export const GET = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const { MailingCampaign, MailingSend, MailingEvent } = ctx.tenantModels;
  const campana = await buscarOFallar(MailingCampaign, id, "Esa campaña");
  const fn = ctx.tenantSequelize.fn;
  const col = ctx.tenantSequelize.col;

  const porEstado = Object.fromEntries(
    (await MailingSend.findAll({ attributes: ["estado", [fn("count", col("id")), "n"]], where: { campaignId: id }, group: ["estado"], raw: true })).map((f) => [f.estado, Number(f.n)])
  );
  const entregados = (porEstado.enviado ?? 0) + (porEstado.rebotado ?? 0) + (porEstado.queja ?? 0);
  const abrieron = await MailingSend.count({ where: { campaignId: id, aperturas: { [Op.gt]: 0 } } });
  const clicaron = await MailingSend.count({ where: { campaignId: id, clics: { [Op.gt]: 0 } } });

  const porEnlace = await MailingEvent.findAll({
    attributes: ["url", "indice", [fn("count", col("id")), "clics"], [fn("count", fn("distinct", col("send_id"))), "personas"]],
    where: { campaignId: id, tipo: "clic" },
    group: ["url", "indice"],
    order: [[fn("count", col("id")), "DESC"]],
    raw: true,
  });

  const q = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  const where = { campaignId: id };
  if (q) where[Op.or] = [{ email: { [Op.iLike]: `%${q}%` } }, { nombre: { [Op.iLike]: `%${q}%` } }];
  const envios = await MailingSend.findAll({
    where,
    attributes: ["id", "email", "nombre", "origen", "estado", "error", "enviadoAt", "abiertoAt", "primerClicAt", "aperturas", "clics"],
    order: [["estado", "ASC"], ["email", "ASC"]],
    limit: 1000,
  });

  return ok({
    campana: { id: campana.id, nombre: campana.nombre, estado: campana.estado, enviados: campana.enviados },
    resumen: {
      total: Object.values(porEstado).reduce((a, b) => a + b, 0),
      porEstado,
      entregados,
      abrieron,
      clicaron,
      tasaClics: entregados ? Math.round((clicaron / entregados) * 1000) / 10 : 0,
      tasaAperturas: entregados ? Math.round((abrieron / entregados) * 1000) / 10 : 0,
    },
    porEnlace: porEnlace.map((e) => ({ url: e.url, indice: e.indice, clics: Number(e.clics), personas: Number(e.personas) })),
    envios: envios.map((e) => e.toJSON()),
  });
});
