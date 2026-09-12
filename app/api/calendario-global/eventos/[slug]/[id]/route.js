import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../../../lib/utils/errors.js";
import { esPeticionDeCalendario } from "../../../../../../lib/auth/backoffice.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { moverEvento } from "../../../../../../lib/calendario-global/eventos.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/calendario-global/eventos/{slug}/{id} — mover un evento del
 * Calendario (fechas, horas, todo-el-día) o cambiarle el estado desde el
 * calendario global. Las tarjetas e hitos de Proyectos van por
 * /api/calendario-global/proyectos/…, no por aquí.
 *
 * Solo esos campos: lo de dentro del evento se edita en el tenant, saltando
 * con /api/calendario-global/salto (ver lib/calendario-global/eventos.js).
 * El `id` se valida como UUID antes de nada (12/09/2026): un
 * `project-task:<uuid>` mandado aquí por error daba 500 de Postgres.
 */
const mover = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { slug, id } = await params;
    if (!/^[a-z0-9_]+$/.test(slug ?? "")) return error("Calendario inválido");
    if (!UUID.test(id ?? "")) return error("Evento inválido");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    // Un JSON válido que no es un objeto (`5`, `"hola"`, `[]`, `null`) daba 500
    // en `moverEvento` («Cannot use 'in' operator»). Igual que las rutas de
    // proyectos (12/09/2026, hallazgo 3 de la revisión).
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Body inválido");

    const evento = await moverEvento({
      usuarioId: ctx.user.id,
      slug,
      taskId: id,
      cambios: body,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });
    return ok(evento);
  } catch (err) {
    return handleRouteError(err);
  }
});

export const PATCH = (request, rc) => (esPeticionDeCalendario(request) ? mover(request, rc) : notFound());
