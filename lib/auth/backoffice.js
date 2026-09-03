/**
 * ¿Esta petición llega por el back-office (admin.salamandrasolutions.com)?
 *
 * Sin dependencias a propósito: lo usan tanto un Route Handler como el
 * middleware, que corre en un runtime más restringido.
 *
 * ── POR QUÉ HAY UN SOLO SITIO QUE LEA ESTO ───────────────────────────────────
 * El middleware ya decidía por host qué rutas existen, y ahora el login decide
 * por host qué cuentas valen. Si cada uno normalizara `ADMIN_HOST` por su cuenta
 * (mayúsculas, espacios, puerto), bastaría una diferencia tonta para que el
 * middleware creyera estar en el back-office y el login no — o al revés, que es
 * peor: dejar entrar con la cuenta del CRM a la pantalla que guarda la ficha de
 * todos los clientes.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */

/**
 * Deja un host comparable: minúsculas, sin espacios y SIN PUERTO.
 *
 * Lo del puerto no es cosmético. La cabecera `Host` puede llegar como
 * `admin.salamandrasolutions.com:443` según lo que haga el proxy de delante, y
 * una igualdad de cadena contra `ADMIN_HOST` fallaría en silencio: la petición
 * degradaría a "esto es el CRM" sin que nadie se entere. Un control de acceso
 * que se cae solo cuando cambia un proxy no es un control.
 */
function normalizar(h) {
  return String(h || "").toLowerCase().trim().split(":")[0];
}

/** El host del back-office, ya normalizado, o cadena vacía si no está configurado. */
export function hostBackoffice() {
  return normalizar(process.env.ADMIN_HOST);
}

/**
 * ¿Viene esta petición por el back-office?
 *
 * Devuelve false si `ADMIN_HOST` no está configurado. Eso es a propósito y
 * cierra en la dirección segura: sin la variable, el middleware ya responde 404
 * a `/admin` en TODAS partes, así que una cuenta de back-office no tendría dónde
 * entrar de todos modos. Mejor una cuenta que no entra que una puerta abierta
 * por una variable que se olvidó de poner.
 *
 * ── LA CABECERA Host LA ESCRIBE EL CLIENTE ───────────────────────────────────
 * Esto NO es una frontera por sí solo: con `curl -H 'Host: ...'` se elige. Lo
 * que lo convierte en fiable son dos cosas de fuera de este fichero:
 *   1. nginx fija `Host` con un valor LITERAL en el bloque del back-office, de
 *      modo que lo que escriba el cliente se descarta;
 *   2. y el candado se comprueba en CADA petición contra el sello que lleva el
 *      token (ver `bo` en el middleware), no solo al entrar — así, aunque
 *      alguien mienta con el Host al pedir la sesión, el login exige además que
 *      la cuenta sea del tipo correcto.
 */
export function esPeticionDeBackoffice(request) {
  const admin = hostBackoffice();
  if (!admin) return false;
  return normalizar(request?.headers?.get?.("host")) === admin;
}

/*
 * ── EL TERCER HOST: EL CALENDARIO GLOBAL (03/09/2026, Rodrigo) ──────────────
 * `CALENDAR_HOST` (p. ej. "calendar.salamandrasolutions.com"; en local
 * "calendar.localhost:3000") sirve una sola pantalla: el calendario de varios
 * clientes a la vez. Se lee AQUÍ, con el mismo normalizador que el back-office
 * y por el mismo motivo: que el middleware y los endpoints digan lo mismo.
 *
 * A diferencia del back-office, en este host entran las cuentas NORMALES del
 * CRM (la de Rodrigo en salamandra_solutions, por ejemplo): la sesión es la
 * de siempre, sin sello propio. Lo que decide qué calendarios ve cada cuenta
 * es la tabla de vínculos (lib/calendario-global/vinculos.js), no el host.
 */

/** El host del calendario global, normalizado, o cadena vacía si no está configurado. */
export function hostCalendario() {
  return normalizar(process.env.CALENDAR_HOST);
}

/** ¿Viene esta petición por el calendario global? Sin `CALENDAR_HOST`, nunca. */
export function esPeticionDeCalendario(request) {
  const cal = hostCalendario();
  if (!cal) return false;
  return normalizar(request?.headers?.get?.("host")) === cal;
}
