import { getTenantContext } from "./tenantResolver.js";
import { handleRouteError } from "../utils/errors.js";

/**
 * Wrapper para Route Handlers que inyecta el contexto de tenant automáticamente.
 *
 * Uso:
 *   export const GET = withTenant(async (request, routeContext, tenantContext) => {
 *     const { tenantModels, hasModule } = tenantContext;
 *     ...
 *   });
 */

/**
 * Devuelve el request con la cabecera `x-user-role` PUESTA AL DÍA.
 *
 * (Motivo del cambio en /lib, regla #2 — arreglo de seguridad 2026-07-28.)
 *
 * QUÉ ARREGLA: el middleware copia el rol desde el JWT, que dura 15 minutos.
 * Unos 90 endpoints deciden permisos leyendo esa cabecera, así que degradar a
 * alguien de admin a usuario —o darle de baja— NO surtía efecto hasta que su
 * pase caducaba: durante ese cuarto de hora seguía pudiendo emitir facturas,
 * confirmar citas o cambiar sueldos. El resolver YA carga el usuario de la base
 * de datos en cada petición (sin caché, a propósito), así que aquí solo hay que
 * hacer que la cabecera diga la verdad.
 *
 * POR QUÉ UN PROXY Y NO UN REQUEST NUEVO: clonar el request obligaría a
 * arrastrar el cuerpo (json/formData) y rompería los handlers que lo leen. El
 * proxy delega TODO en el request real —cuerpo, cookies, url, método— y solo
 * sustituye `headers`. Los ~90 endpoints no se tocan: siguen leyendo la misma
 * cabecera, pero ahora con el rol de verdad.
 */
function conRolFresco(request, rolFresco) {
  let headers;
  try {
    headers = new Headers(request.headers);
    headers.set("x-user-role", rolFresco);
  } catch {
    return request; // ante cualquier rareza, no romper la petición
  }

  return new Proxy(request, {
    get(target, prop) {
      if (prop === "headers") return headers;
      const valor = Reflect.get(target, prop, target);
      // Los métodos (json, formData, text…) se atan al request REAL: atados al
      // proxy perderían su estado interno.
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  });
}

export function withTenant(handler) {
  return async function (request, routeContext) {
    try {
      const tenantContext = await getTenantContext(request);

      // Rol fresco de BD > rol del token. Si el usuario ya no existe, el
      // resolver ha lanzado antes (falla en cerrado).
      const rolFresco = tenantContext?.user?.role;
      const peticion =
        rolFresco && rolFresco !== request.headers.get("x-user-role")
          ? conRolFresco(request, rolFresco)
          : request;

      return await handler(peticion, routeContext, tenantContext);
    } catch (err) {
      return handleRouteError(err);
    }
  };
}
