import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../lib/utils/errors.js";
import { esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { emitirSalto } from "../../../../lib/calendario-global/salto.js";
import { auditar } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/calendario-global/salto — el pase para abrir el CRM del cliente
 * con sesión y aterrizar donde toque.
 *
 *   { slug, destino }  con destino = { tipo: "calendario", taskId?, fecha? }
 *                                  | { tipo: "proyecto", projectId }
 *                                  | { tipo: "tablero", projectId }
 *   { slug, taskId?, fecha? }       la forma de antes del 12/09/2026, que es
 *                                   un destino de calendario
 *
 * Devuelve `{ url, caducaEn, como, email }`: la URL a la que mandar el
 * navegador (un solo uso, 60 s) y con qué cuenta se va a entrar, para que la
 * pantalla lo diga cuando es «como admin». Ver lib/calendario-global/salto.js.
 */
const emitir = withTenant(async (request, _rc, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const slug = String(body?.slug ?? "");
    if (!/^[a-z0-9_]+$/.test(slug)) return error("Calendario inválido");

    const destino =
      body?.destino && typeof body.destino === "object"
        ? body.destino
        : { tipo: "calendario", taskId: body?.taskId ?? null, fecha: body?.fecha ?? null };

    const pase = await emitirSalto({ usuarioId: ctx.user.id, slug, destino });

    // Queda apuntado quién pidió saltar a dónde y cómo: un pase es una sesión.
    await auditar({
      tenantId: ctx.tenant.id,
      userId: ctx.user.id,
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "calendario_global.salto.emitido",
      entity: "Tenant",
      entityId: null,
      after: { slug, destino: destino.tipo ?? "calendario", como: pase.como },
    });

    return ok(pase);
  } catch (err) {
    return handleRouteError(err);
  }
});

export const POST = (request, rc) => (esPeticionDeCalendario(request) ? emitir(request, rc) : notFound());
