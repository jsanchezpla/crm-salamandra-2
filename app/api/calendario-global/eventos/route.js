import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { leerEventos } from "../../../../lib/calendario-global/eventos.js";

/**
 * GET /api/calendario-global/eventos?start&end — los eventos de todos los
 * calendarios vinculados a la cuenta que mira (03/09/2026, Rodrigo).
 *
 * Solo existe en CALENDAR_HOST (middleware.js). `withTenant` da aquí el
 * contexto del tenant PROPIO de la cuenta —el de su sesión—, que solo se usa
 * para saber quién es (fresco de BD) y para vetar la demo: qué calendarios ve
 * lo decide la tabla de vínculos, no su tenant.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    // La demo es pública y da sesión de admin a cualquiera: aquí no entra.
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const datos = await leerEventos({ usuarioId: ctx.user.id, start, end });
    return ok(datos);
  } catch (err) {
    return serverError(err);
  }
});
