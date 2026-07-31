/**
 * lib/demo/isDemo.js — helpers de la demo pública (slug "demo").
 *
 * La demo es pública y NO debe: (a) gastar tokens de IA real, ni (b) escribir
 * en el schema master (que el auto-reset NO restaura). Estos helpers concentran
 * esas dos decisiones para no repetir strings mágicos por el código.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */
// Desde `errorTypes.js` y no desde `errors.js`: aquel arrastra Next y dejaría
// este guard —y con él toda la capa de pagos que lo llama— sin poder importarse
// desde un script de Node suelto, que es donde se prueba el cobro offline.
import { ForbiddenError } from "../utils/errorTypes.js";

const DEMO_SLUG = "demo";

export function isDemoTenant(ctx) {
  return !!ctx && ctx.slug === DEMO_SLUG;
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
 * que alguien meta una clave "solo para probar".
 */
export function assertNotDemoPaidCall(ctx, accion = "Esta acción") {
  if (isDemoTenant(ctx)) {
    throw new ForbiddenError(`${accion} está desactivada en la demo: usa datos de ejemplo.`);
  }
}
