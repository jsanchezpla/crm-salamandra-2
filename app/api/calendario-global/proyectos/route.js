import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { listarProyectos } from "../../../../lib/calendario-global/proyectos.js";

/**
 * GET /api/calendario-global/proyectos?slugs=a,b&estado=activos|todos&q= — los
 * proyectos de los clientes que ve la cuenta, con su avance (12/09/2026, Rodrigo).
 *
 * `slugs` ausente = todos; `slugs=` vacío = ninguno (la pantalla lo manda así
 * cuando se ocultan todos los clientes). Ver lib/calendario-global/proyectos.js.
 */
const manejar = withTenant(async (request, _rc, ctx) => {
  try {
    // La demo es pública y da sesión de admin a cualquiera: aquí no entra.
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { searchParams } = new URL(request.url);
    const slugs = searchParams.has("slugs")
      ? String(searchParams.get("slugs") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[a-z0-9_]+$/.test(s))
      : null;
    const estado = searchParams.get("estado") || "activos";
    if (estado !== "activos" && estado !== "todos") return error("Estado inválido");
    const busqueda = String(searchParams.get("q") ?? "").slice(0, 100);

    const datos = await listarProyectos({ usuarioId: ctx.user.id, slugs, estado, busqueda });
    return ok(datos);
  } catch (err) {
    return handleRouteError(err);
  }
});

export function GET(request, routeContext) {
  // Defensa en profundidad: el middleware ya lo esconde fuera de CALENDAR_HOST,
  // pero si su lista cambiara, este endpoint no debe existir en otro host.
  if (!esPeticionDeCalendario(request)) return notFound();
  return manejar(request, routeContext);
}
