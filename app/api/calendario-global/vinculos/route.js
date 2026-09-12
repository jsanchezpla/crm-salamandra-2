import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../lib/utils/errors.js";
import { esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { calendariosDe, fichaPublica } from "../../../../lib/calendario-global/acceso.js";

/**
 * GET /api/calendario-global/vinculos — quién soy y qué clientes veo, para la
 * cabecera y la barra lateral de las dos pestañas (Calendario y Proyectos).
 * Solo lectura: los vínculos se ponen desde el back-office o por script.
 *
 * Desde el 12/09/2026 la lista sale de `calendariosDe` (lib/calendario-global/
 * acceso.js): un admin de Salamandra ve TODOS los clientes (`yo.todos`), el
 * resto sus vínculos. Cada ficha dice si el cliente tiene Calendario y
 * Proyectos y con qué cuenta se abriría su CRM (`saltoComo`, `saltoEmail`).
 *
 * 404 fuera del host `calendar.`, aunque el middleware ya lo haga: una ruta que
 * enumera todos los clientes no puede depender solo del matcher (la trampa de
 * las rutas que acaban en `.png`, lib/buzon/candadoBackoffice.js).
 */
const leer = withTenant(async (request, _rc, ctx) => {
  try {
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();
    const { todos, calendarios } = await calendariosDe(ctx.user.id);
    return ok({
      yo: {
        id: ctx.user.id,
        email: request.headers.get("x-user-email") ?? null,
        tenant: ctx.tenant.name,
        todos,
      },
      calendarios: calendarios.map(fichaPublica),
    });
  } catch (err) {
    return handleRouteError(err);
  }
});

export const GET = (request, rc) => (esPeticionDeCalendario(request) ? leer(request, rc) : notFound());
