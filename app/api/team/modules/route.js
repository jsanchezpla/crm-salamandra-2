import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getTenantModuleKeys } from "../../../../lib/team/access.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/team/modules — módulos activos del TENANT, para pintar los
 * checkboxes de acceso en el ALTA de empleado (cuando aún no hay [id]).
 *
 * No confundir con /api/auth/me → enabledModules: aquello es la intersección
 * con el moduleAccess del usuario actual; esto es la lista completa del tenant,
 * que es lo que un admin puede conceder.
 *
 * Rol leído de ctx.user (fresco de BD), no del header x-user-role del JWT:
 * esta información alimenta una pantalla que escribe en master.
 */
export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    if (!ctx.hasModule("team")) return forbidden("Módulo team no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");

    const modules = await getTenantModuleKeys(ctx.tenant.id);
    return ok({ modules });
  } catch (err) {
    return serverError(err);
  }
});
