import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { emailValido, exigirMailing, leerBody, texto } from "../../../../lib/mailing/comun.js";
import { suprimirEmail } from "../../../../lib/mailing/supresion.js";

/**
 * /api/mailing/supresiones — de aquí no sale nadie nunca más.
 *
 * GET  ?q=   la lista (bajas, rebotes, quejas y las añadidas a mano).
 * POST       añadir una dirección a mano («esta persona me ha pedido por
 *            teléfono que no le escribamos»). NO hay DELETE a propósito: una
 *            baja no se deshace desde el CRM. Si alguien quiere volver, se
 *            apunta de nuevo con su consentimiento y lo resuelve Salamandra.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const q = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  const where = q ? { email: { [Op.iLike]: `%${q}%` } } : {};
  const { MailingSuppression } = ctx.tenantModels;
  const { rows, count } = await MailingSuppression.findAndCountAll({ where, order: [["createdAt", "DESC"]], limit: 500 });
  const porMotivo = Object.fromEntries(
    (await MailingSuppression.findAll({
      attributes: ["motivo", [ctx.tenantSequelize.fn("count", ctx.tenantSequelize.col("id")), "n"]],
      group: ["motivo"],
      raw: true,
    })).map((f) => [f.motivo, Number(f.n)])
  );
  return ok({ supresiones: rows.map((s) => s.toJSON()), total: count, porMotivo });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const email = emailValido(body.email, "El correo");
  const r = await suprimirEmail(ctx, { email, motivo: "manual", detalle: texto(body.detalle, 300) || "añadida a mano desde el CRM" });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.supresion.created",
    entity: "mailing_suppression",
    entityId: r.fila?.id ?? null,
    after: { motivo: "manual", nueva: r.nueva },
  });
  return ok({ supresion: r.fila?.toJSON?.() ?? r.fila, nueva: r.nueva });
});
