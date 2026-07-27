/**
 * lib/demo/isDemo.js — helpers de la demo pública (slug "demo").
 *
 * La demo es pública y NO debe: (a) gastar tokens de IA real, ni (b) escribir
 * en el schema master (que el auto-reset NO restaura). Estos helpers concentran
 * esas dos decisiones para no repetir strings mágicos por el código.
 *
 * (Fichero nuevo en /lib, regla #2.)
 */
import { ForbiddenError } from "../utils/errors.js";

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
