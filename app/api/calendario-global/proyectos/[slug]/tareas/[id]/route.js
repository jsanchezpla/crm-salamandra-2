import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../../../../lib/demo/isDemo.js";
import { esPeticionDeCalendario } from "../../../../../../../lib/auth/backoffice.js";
import { moverTarjetaGlobal, cambiarFechaTarjeta } from "../../../../../../../lib/calendario-global/proyectos.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/calendario-global/proyectos/{slug}/tareas/{id} — una tarjeta del
 * Kanban de un cliente, desde el calendario global (12/09/2026, Rodrigo).
 *
 * Dos cosas y solo dos, y nunca a la vez:
 *   { dueDate: "YYYY-MM-DD" | null }             → cambiar o quitar la fecha límite
 *   { targetBoardColumnId, targetOrder }         → moverla de columna / posición
 * Lo demás de la tarjeta se edita en el CRM del cliente (ver
 * lib/calendario-global/proyectos.js).
 */
const manejar = withTenant(async (request, { params }, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { slug, id } = await params;
    if (!/^[a-z0-9_]+$/.test(slug ?? "")) return error("Cliente inválido");
    if (!UUID.test(id ?? "")) return error("Tarea inválida");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Body inválido");

    const conFecha = "dueDate" in body;
    const conMovimiento = "targetBoardColumnId" in body || "targetOrder" in body;
    if (conFecha && conMovimiento) return error("O se cambia la fecha o se mueve la tarjeta, no las dos cosas a la vez");
    if (!conFecha && !conMovimiento) return error("Nada que cambiar");

    const comun = {
      usuarioId: ctx.user.id,
      slug,
      taskId: id,
      ip: request.headers.get("x-forwarded-for") ?? null,
    };
    const datos = conFecha
      ? await cambiarFechaTarjeta({ ...comun, dueDate: body.dueDate })
      : await moverTarjetaGlobal({ ...comun, targetBoardColumnId: body.targetBoardColumnId, targetOrder: body.targetOrder });
    return ok(datos);
  } catch (err) {
    return handleRouteError(err);
  }
});

export function PATCH(request, routeContext) {
  // Defensa en profundidad: fuera de CALENDAR_HOST este endpoint no existe.
  if (!esPeticionDeCalendario(request)) return notFound();
  return manejar(request, routeContext);
}
