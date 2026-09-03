import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { vinculosDe } from "../../../../lib/calendario-global/vinculos.js";

/**
 * GET /api/calendario-global/vinculos — quién soy y qué calendarios veo, para
 * la cabecera y la leyenda de la pantalla. Solo lectura: los vínculos se
 * ponen desde el back-office o por script, nunca desde aquí.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();
    const calendarios = await vinculosDe(ctx.user.id);
    return ok({
      yo: { email: request.headers.get("x-user-email") ?? null, tenant: ctx.tenant.name },
      calendarios: calendarios.map((v) => ({
        slug: v.slug,
        nombre: v.nombre,
        color: v.color,
        calendario: v.calendario,
        puedeSaltar: !!v.tenantUsuarioId,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});
