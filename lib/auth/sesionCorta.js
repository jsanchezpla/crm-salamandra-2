/**
 * lib/auth/sesionCorta.js — lo que se puede decidir sin base de datos, sin Next
 * y sin React sobre la sesión «como admin» del calendario global (12/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo usan a la vez `SessionKeeper` —en el
 * navegador—, `lib/auth/jwt.js`, `withTenant` y el modelo `AuditLog` —en el
 * servidor—, y la prueba ligera `_smoke-sesion-corta.mjs` lo carga con Node
 * suelto. Por eso no importa nada.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * La revisión del calendario global v2 encontró dos cosas de esa sesión:
 *   · SessionKeeper intentaba renovarla a los 12 minutos (o a los 10 al volver
 *     a la pestaña); como no lleva refresh token, el refresh daba 401 y mandaba
 *     al login con el access token aún vivo. La pantalla promete 15 minutos.
 *   · Lo que se hacía dentro quedaba a nombre de la cuenta admin del cliente,
 *     sin rastro de quién de Salamandra fue.
 * Ver docs/decisions/2026-09-12-el-calendario-global-ve-todos-y-los-proyectos.md.
 */

/**
 * La cookie que marca una sesión que NO se renueva. No es httpOnly a propósito:
 * la lee SessionKeeper en el navegador. No da acceso a nada —la sesión la
 * decide `access_token`, httpOnly—; solo dice «no intentes renovar hasta este
 * instante». Su valor es la caducidad en milisegundos desde epoch.
 */
export const COOKIE_SESION_CORTA = "sesion_corta";

/** El valor de una cookie dentro de una cadena `a=1; b=2`, o null. */
export function leerCookie(cadena, nombre) {
  if (typeof cadena !== "string" || !cadena || !nombre) return null;
  for (const trozo of cadena.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() !== nombre) continue;
    const valor = trozo.slice(i + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return null;
}

/**
 * ¿Hay una sesión corta todavía viva? Recibe `document.cookie` (o cualquier
 * cabecera Cookie). Un valor que no sea un número entero de milisegundos cuenta
 * como «no hay»: ante la duda SessionKeeper hace lo de siempre, renovar.
 */
export function sesionCortaVigente(cadenaCookies, ahora = Date.now()) {
  const valor = leerCookie(cadenaCookies, COOKIE_SESION_CORTA);
  if (!valor || !/^\d{1,16}$/.test(valor)) return false;
  return Number(valor) > ahora;
}

/**
 * El `after` de una fila de auditoría con la autoría de la sesión «como admin»
 * añadida (`comoAdminDesde`: el id de la cuenta de Salamandra que entró). PURA.
 *
 * Solo se toca un `after` nulo o un objeto plano: un array, un texto o un
 * número se guardan tal cual, porque meterles un campo cambiaría su forma y
 * alguien los lee así. Sin impersonador, devuelve lo mismo que recibió.
 */
export function marcarAutoria(after, impersonadorId) {
  if (typeof impersonadorId !== "string" || !impersonadorId) return after;
  if (after == null) return { comoAdminDesde: impersonadorId };
  if (typeof after !== "object" || Array.isArray(after)) return after;
  const proto = Object.getPrototypeOf(after);
  if (proto !== Object.prototype && proto !== null) return after;
  return { ...after, comoAdminDesde: impersonadorId };
}
