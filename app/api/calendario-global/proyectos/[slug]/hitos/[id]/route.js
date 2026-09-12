import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../../../../lib/demo/isDemo.js";
import { esPeticionDeCalendario } from "../../../../../../../lib/auth/backoffice.js";
import { cambiarFechaHito } from "../../../../../../../lib/calendario-global/proyectos.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/calendario-global/proyectos/{slug}/hitos/{id} { dueDate } — la
 * fecha de un hito pendiente de un cliente, desde el calendario global
 * (12/09/2026, Rodrigo). Solo la fecha; el resto, en su CRM (ver
 * lib/calendario-global/proyectos.js).
 */
const manejar = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { slug, id } = await params;
    if (!/^[a-z0-9_]+$/.test(slug ?? "")) return error("Cliente inválido");
    if (!UUID.test(id ?? "")) return error("Hito inválido");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Body inválido");
    if (!("dueDate" in body)) return error("Nada que cambiar");

    const hito = await cambiarFechaHito({
      usuarioId: ctx.user.id,
      slug,
      milestoneId: id,
      dueDate: body.dueDate,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });
    return ok(hito);
  } catch (err) {
    return handleRouteError(err);
  }
});

export function PATCH(request, routeContext) {
  // Defensa en profundidad: fuera de CALENDAR_HOST este endpoint no existe.
  if (!esPeticionDeCalendario(request)) return notFound();
  return manejar(request, routeContext);
}
