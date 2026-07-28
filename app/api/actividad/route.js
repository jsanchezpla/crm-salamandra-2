import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { etiqueta, prefijosDeModulo } from "../../../lib/actividad/etiquetas.js";

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
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");

    const { searchParams } = new URL(request.url);
    const dias = Math.min(90, Math.max(1, Number(searchParams.get("dias")) || 7));
    const filtroModulo = searchParams.get("modulo") || null;
    const filtroUsuario = searchParams.get("usuario") || null;
    if (filtroUsuario && !/^[0-9a-f-]{36}$/i.test(filtroUsuario)) return error("usuario inválido", 422);

    const { AuditLog, User } = getMasterModels();
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const where = { tenantId: ctx.tenant.id, createdAt: { [Op.gte]: desde } };
    if (filtroUsuario) where.userId = filtroUsuario;

    // El filtro por módulo va en SQL, ANTES del límite: aplicado después, pedir
    // "solo Facturación" enseñaba las de facturación que hubiera entre las 400
    // últimas de TODO el CRM, no las 400 últimas de facturación.
    const porModulo = prefijosDeModulo(filtroModulo);
    if (porModulo?.prefijos) {
      where.action = { [Op.or]: porModulo.prefijos.map((p) => ({ [Op.like]: `${p}.%` })) };
    } else if (porModulo?.excluir) {
      where.action = { [Op.and]: porModulo.excluir.map((p) => ({ [Op.notLike]: `${p}.%` })) };
    }

    const rows = await AuditLog.findAll({
      where,
      attributes: ["id", "userId", "action", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: MAX_FILAS,
    });

    // Opciones de los desplegables: los módulos y usuarios CON actividad en el
    // rango, calculados sin aplicar los filtros (si no, al elegir un módulo el
    // desplegable se quedaría con esa única opción y no habría forma de volver).
    const opciones = await (async () => {
      try {
        const filas = await AuditLog.findAll({
          where: { tenantId: ctx.tenant.id, createdAt: { [Op.gte]: desde } },
          attributes: ["action", "userId"],
          group: ["action", "userId"],
          raw: true,
        });
        return {
          modulos: [...new Set(filas.map((f) => etiqueta(f.action).modulo))].sort((a, b) => a.localeCompare(b)),
          usuarios: [...new Set(filas.map((f) => f.userId).filter(Boolean))],
        };
      } catch {
        return null; // se cae al cálculo sobre las filas ya traídas
      }
    })();

    // Emails de todos los autores del rango, resueltos de una vez.
    const ids = [...new Set([...rows.map((r) => r.userId), ...(opciones?.usuarios ?? [])].filter(Boolean))];
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

    // Red de seguridad: el LIKE por prefijo no distingue "client." de
    // "clinica." mejor que el propio catálogo, así que se vuelve a comprobar
    // la etiqueta ya calculada. Sobre un conjunto ya filtrado en SQL, esto no
    // recorta nada real.
    const filas = filtroModulo ? todas.filter((f) => f.modulo === filtroModulo) : todas;

    return ok({
      dias,
      truncado: rows.length === MAX_FILAS,
      filas,
      usuarios: ids.map((id) => ({ id, email: emails[id] || "(usuario eliminado)" })).sort((a, b) => a.email.localeCompare(b.email)),
      modulos: opciones?.modulos ?? [...new Set(todas.map((f) => f.modulo))].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    return serverError(err);
  }
});
