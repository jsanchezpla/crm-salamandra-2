import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../lib/utils/errors.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { emitirSalto } from "../../../../lib/calendario-global/salto.js";
import { auditar } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/calendario-global/salto { slug, taskId?, fecha? } — el pase para
 * abrir el CRM del cliente con sesión y aterrizar en el evento.
 *
 * Devuelve la URL a la que mandar el navegador (un solo uso, 60 s). Ver
 * lib/calendario-global/salto.js.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const slug = String(body?.slug ?? "");
    if (!/^[a-z0-9_]+$/.test(slug)) return error("Calendario inválido");

    const pase = await emitirSalto({
      usuarioId: ctx.user.id,
      slug,
      taskId: body?.taskId ? String(body.taskId) : null,
      fecha: body?.fecha ? String(body.fecha) : null,
    });

    // Queda apuntado quién pidió saltar a dónde: un pase es una sesión.
    await auditar({
      tenantId: ctx.tenant.id,
      userId: ctx.user.id,
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "calendario_global.salto.emitido",
      entity: "Tenant",
      entityId: null,
      after: { slug, taskId: body?.taskId ?? null },
    });

    return ok(pase);
  } catch (err) {
    return handleRouteError(err);
  }
});
