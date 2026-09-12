import { getTenantContext } from "./tenantResolver.js";
import { handleRouteError, UnauthorizedError } from "../utils/errors.js";
import { conContextoDeUso } from "../ai/usoDeIA.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { leerCookie } from "../auth/sesionCorta.js";
import { esAdminDeSalamandra } from "../calendario-global/acceso.js";

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

/**
 * ¿Es esta petición de una sesión «como admin» del calendario global? Devuelve
 * el id de la cuenta de Salamandra que entró, o null.
 *
 * (Motivo del cambio en /lib, regla #2 — revisión del calendario global v2,
 * 12/09/2026.)
 *
 * QUÉ ARREGLA: `/api/auth/saltar` abre esa sesión con la cuenta admin del
 * cliente, y el access token vive 15 minutos. `esAdminDeSalamandra` solo se
 * miraba al emitir y al canjear el pase: si a quien entró le quitaban el admin
 * de Salamandra un minuto después, seguía dentro del cliente el resto del
 * cuarto de hora. Y lo que hacía quedaba a nombre del director del cliente.
 *
 * CÓMO: el token de esa sesión lleva `imp`. Se lee de la cookie `access_token`
 * y se VERIFICA la firma aquí (HMAC local, sin base de datos); nunca de una
 * cabecera, que la podría mandar el cliente. Si la firma no vale se ignora: la
 * autenticación ya la ha decidido el middleware. El `userId` del token tiene
 * que ser el usuario de esta petición, para no mezclar sesiones. Solo cuesta
 * algo cuando hay cookie, y la consulta a master solo cuando trae `imp`.
 */
async function impersonadorDe(request, tenantContext) {
  const userId = tenantContext?.user?.id;
  if (!userId) return null;

  let token = null;
  try {
    token =
      request.cookies?.get?.("access_token")?.value ??
      leerCookie(request.headers?.get?.("cookie"), "access_token");
  } catch {
    token = null;
  }
  if (!token) return null;

  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    return null;
  }
  const imp = payload?.imp;
  if (typeof imp !== "string" || !imp || payload.userId !== userId) return null;

  // Fresco de master, sin caché, como el rol: degradarle corta la sesión ya.
  if (!(await esAdminDeSalamandra(imp))) {
    throw new UnauthorizedError("La sesión como admin ya no es válida");
  }
  return imp;
}

export function withTenant(handler) {
  return async function (request, routeContext) {
    try {
      const tenantContext = await getTenantContext(request);
      const impersonadorId = await impersonadorDe(request, tenantContext);

      // Rol fresco de BD > rol del token. Si el usuario ya no existe, el
      // resolver ha lanzado antes (falla en cerrado).
      const rolFresco = tenantContext?.user?.role;
      const peticion =
        rolFresco && rolFresco !== request.headers.get("x-user-role")
          ? conRolFresco(request, rolFresco)
          : request;

      // Contexto de la contabilidad de la IA (`lib/ai/usoDeIA.js`): quién hace
      // la petición, para que el cliente de Anthropic sepa a quién apuntar cada
      // llamada sin que haya que pasárselo a mano por las 17 rutas que la usan.
      // Desde el 12/09/2026 lleva también `impersonadorId`: el modelo AuditLog
      // lo lee para firmar cada fila de una sesión «como admin».
      return await conContextoDeUso(
        {
          tenantId: tenantContext?.tenant?.id ?? null,
          userId: tenantContext?.user?.id ?? null,
          impersonadorId,
        },
        () => handler(peticion, routeContext, tenantContext)
      );
    } catch (err) {
      return handleRouteError(err);
    }
  };
}
