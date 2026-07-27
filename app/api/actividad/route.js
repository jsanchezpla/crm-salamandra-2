import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { etiqueta } from "../../../lib/actividad/etiquetas.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const MAX_FILAS = 400;

/**
 * GET /api/actividad?dias=7&modulo=Equipo&usuario=<uuid>
 *
 * Registro de actividad del tenant para la pantalla Equipo → Actividad:
 * qué ha hecho cada usuario, cuándo y en qué módulo, en frases legibles.
 *
 * Lee master.audit_logs filtrado por tenantId y traduce cada acción con
 * lib/actividad/etiquetas.js. Solo admin (rol fresco de BD): el registro
 * cruza TODOS los módulos, no se gatea por ninguno en concreto.
 *
 * Respuesta: { dias, filas: [{ id, cuando, usuario, modulo, texto }],
 *              usuarios: [{ id, email }], modulos: [..] }
 * `usuarios` y `modulos` son los presentes en el rango, para los filtros.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");

    const { searchParams } = new URL(request.url);
    const dias = Math.min(90, Math.max(1, Number(searchParams.get("dias")) || 7));
    const filtroModulo = searchParams.get("modulo") || null;
    const filtroUsuario = searchParams.get("usuario") || null;
    if (filtroUsuario && !/^[0-9a-f-]{36}$/i.test(filtroUsuario)) return error("usuario inválido", 422);

    const { AuditLog, User } = getMasterModels();
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const where = { tenantId: ctx.tenant.id, createdAt: { [Op.gte]: desde } };
    if (filtroUsuario) where.userId = filtroUsuario;

    const rows = await AuditLog.findAll({
      where,
      attributes: ["id", "userId", "action", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: MAX_FILAS,
    });

    // Emails de todos los autores del rango, resueltos de una vez.
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const emails = {};
    if (ids.length) {
      const users = await User.findAll({ where: { id: ids }, attributes: ["id", "email"] });
      for (const u of users) emails[u.id] = u.email;
    }

    const todas = rows.map((r) => {
      const { modulo, texto } = etiqueta(r.action);
      return {
        id: r.id,
        cuando: r.createdAt,
        usuarioId: r.userId,
        usuario: r.userId ? emails[r.userId] || "(usuario eliminado)" : "Sistema",
        modulo,
        texto,
      };
    });

    const filas = filtroModulo ? todas.filter((f) => f.modulo === filtroModulo) : todas;

    return ok({
      dias,
      truncado: rows.length === MAX_FILAS,
      filas,
      usuarios: ids.map((id) => ({ id, email: emails[id] || "(usuario eliminado)" })).sort((a, b) => a.email.localeCompare(b.email)),
      modulos: [...new Set(todas.map((f) => f.modulo))].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    return serverError(err);
  }
});
