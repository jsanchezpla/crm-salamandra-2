import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { esPeticionDeCalendario } from "../../../../../../lib/auth/backoffice.js";
import { leerTablero } from "../../../../../../lib/calendario-global/proyectos.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/calendario-global/proyectos/{slug}/{id} — el tablero de un proyecto
 * de un cliente, para verlo y mover tarjetas desde el calendario global
 * (12/09/2026, Rodrigo). Ver lib/calendario-global/proyectos.js.
 */
const manejar = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { slug, id } = await params;
    if (!/^[a-z0-9_]+$/.test(slug ?? "")) return error("Cliente inválido");
    if (!UUID.test(id ?? "")) return error("Proyecto inválido");

    const tablero = await leerTablero({ usuarioId: ctx.user.id, slug, projectId: id });
    return ok(tablero);
  } catch (err) {
    return handleRouteError(err);
  }
});

export function GET(request, routeContext) {
  // Defensa en profundidad: fuera de CALENDAR_HOST este endpoint no existe.
  if (!esPeticionDeCalendario(request)) return notFound();
  return manejar(request, routeContext);
}
