/**
 * lib/demo/isDemo.js — helpers de las demos públicas.
 *
 * Las demos son públicas y NO deben: (a) gastar tokens de IA real, ni (b)
 * escribir en el schema master (que el auto-reset NO restaura). Estos helpers
 * concentran esas dos decisiones para no repetir strings mágicos por el código.
 *
 * (Fichero nuevo en /lib, regla #2.)
 *
 * ── YA NO ES UN SOLO SLUG (13/08/2026) ──────────────────────────────────────
 * Había un `DEMO_SLUG = "demo"` escrito aquí y noventa y cuatro llamadas a
 * estos tres guards repartidas por el CRM. Al partir la demo en una por oficio
 * (lib/demo/demos.js), cambiar SOLO este fichero es lo que hace que las cuatro
 * queden protegidas a la vez: si la comparación se hubiera quedado en
 * `ctx.slug === "demo"`, las tres nuevas habrían nacido siendo un CRM de admin
 * público capaz de gastar IA real y de escribir en master.
 */
// Desde `errorTypes.js` y no desde `errors.js`: aquel arrastra Next y dejaría
// este guard —y con él toda la capa de pagos que lo llama— sin poder importarse
// desde un script de Node suelto, que es donde se prueba el cobro offline.
import { ForbiddenError } from "../utils/errorTypes.js";
import { esSlugDemo } from "./demos.js";

export { esSlugDemo };

export function isDemoTenant(ctx) {
  return !!ctx && esSlugDemo(ctx.slug);
}

// La demo enseña la IA en modo SIMULADO (datos falsos), nunca llama a la API
// real: así se puede ver cómo funciona sin coste ni clave.
export function demoForcesFakeAi(ctx) {
  return isDemoTenant(ctx);
}

// Corta cualquier escritura sobre el schema master desde la demo pública
// (ajustes del tenant, claves de IA, módulos, incentivos...). Se llama al
// principio de esos handlers.
export function assertNotDemoMasterWrite(ctx) {
  if (isDemoTenant(ctx)) {
    throw new ForbiddenError("En la demo no se pueden cambiar los ajustes: es de solo lectura.");
  }
}

/**
 * Corta las llamadas a PROVEEDORES DE PAGO desde la demo pública: IA real
 * (Whisper/Claude), Google Places y envío de correo (Resend).
 *
 * Motivo: la demo da sesión de ADMIN a visitantes ANÓNIMOS. Donde no se pueda
 * simular la respuesta (para eso está `demoForcesFakeAi`), hay que cortar: si
 * algún día el tenant demo tuviera claves configuradas, cualquiera podría
 * quemar tokens/cuota — o usar el envío de correo como relé de spam, porque el
 * destinatario va en el body de la petición.
 *
 * Hoy el tenant demo no tiene ninguna clave (verificado en producción el
 * 2026-07-25), así que esto es defensa en profundidad: cierra la mina antes de
 * que alguien meta una clave "solo para probar". Desde el 13/08/2026 el
 * back-office tampoco deja ponérsela a una demo aunque se lo pidan
 * (lib/provisioning/credencialesCliente.js): eran dos puertas y ahora las dos
 * están cerradas.
 */
export function assertNotDemoPaidCall(ctx, accion = "Esta acción") {
  if (isDemoTenant(ctx)) {
    throw new ForbiddenError(`${accion} está desactivada en la demo: usa datos de ejemplo.`);
  }
}
