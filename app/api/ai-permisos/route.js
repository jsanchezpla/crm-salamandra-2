import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { aiRestringido } from "../../../lib/ai/aiAccess.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/ai-permisos — panel de permisos de IA (Configuración → IA).
 *
 * Solo admin. Devuelve el modo del tenant y las filas relevantes con el email
 * de cada usuario resuelto contra master.users:
 *   { restringido, pendientes: [...], concedidos: [...], recientes: [...] }
 *
 * `recientes` = denegados/revocados/consumidos de los últimos 30 días, para
 * que el admin tenga contexto de lo que ya decidió.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");

    const { AiPermission } = ctx.tenantModels;
    if (!AiPermission) return ok({ restringido: aiRestringido(ctx), pendientes: [], concedidos: [], recientes: [] });

    let rows = [];
    try {
      rows = await AiPermission.findAll({
        where: {
          [Op.or]: [
            { status: ["pendiente", "concedido"] },
            { updatedAt: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          ],
        },
        order: [["createdAt", "DESC"]],
        limit: 200,
      });
    } catch {
      // Tabla sin migrar en este tenant: panel vacío, no un 500.
      return ok({ restringido: aiRestringido(ctx), pendientes: [], concedidos: [], recientes: [] });
    }

    // Emails de los implicados, resueltos de una vez.
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.decidedBy]).filter(Boolean))];
    const emails = {};
    if (ids.length) {
      const { User } = getMasterModels();
      const users = await User.findAll({ where: { id: ids }, attributes: ["id", "email"] });
      for (const u of users) emails[u.id] = u.email;
    }

    const serialize = (r) => ({
      id: r.id,
      usuario: emails[r.userId] || "(usuario eliminado)",
      status: r.status,
      scope: r.scope,
      accion: r.accion,
      usada: !!r.usedAt,
      solicitadaEl: r.createdAt,
      decididaEl: r.decidedAt,
      decididaPor: r.decidedBy ? emails[r.decidedBy] || null : null,
    });

    const pendientes = rows.filter((r) => r.status === "pendiente").map(serialize);
    // Concesión viva = general, o de una vez aún sin gastar.
    const concedidos = rows
      .filter((r) => r.status === "concedido" && (r.scope === "general" || !r.usedAt))
      .map(serialize);
    const vivas = new Set([...pendientes, ...concedidos].map((r) => r.id));
    const recientes = rows.filter((r) => !vivas.has(r.id)).map(serialize).slice(0, 30);

    return ok({ restringido: aiRestringido(ctx), pendientes, concedidos, recientes });
  } catch (err) {
    return serverError(err);
  }
});
