import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { moverEvento } from "../../../../../../lib/calendario-global/eventos.js";

/**
 * PATCH /api/calendario-global/eventos/{slug}/{id} — mover un evento (fechas,
 * horas, todo-el-día) o cambiarle el estado desde el calendario global.
 *
 * Solo esos campos: lo de dentro del evento se edita en el tenant, saltando
 * con /api/calendario-global/salto (ver lib/calendario-global/eventos.js).
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { slug, id } = await params;
    if (!/^[a-z0-9_]+$/.test(slug ?? "")) return error("Calendario inválido");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const evento = await moverEvento({
      usuarioId: ctx.user.id,
      slug,
      taskId: id,
      cambios: body ?? {},
      ip: request.headers.get("x-forwarded-for") ?? null,
    });
    return ok(evento);
  } catch (err) {
    return handleRouteError(err);
  }
});
