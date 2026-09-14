/**
 * lib/ai/modoDeIa.js — cómo va a contestar una ruta que responde IGUAL sin IA
 * (14/09/2026, tarea del Registro «El Salamandrobot busca fichas de clientes
 * sin comprobar que el centro o la persona tengan Clientes»).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten las tres rutas que tienen
 * sustituto sin IA —`app/api/assistant`, `app/api/calendar/reorganize` y
 * `app/api/citas/bookings/[id]/suggest-slots`—. Escrito en cada una, el día que
 * cambie se quedaría viejo en dos.)
 *
 * ── EL ORDEN ───────────────────────────────────────────────────────────────
 *   1. ¿Simulado? En las CUATRO demos (`demoForcesFakeAi`) o por la variable
 *      de entorno de cada pieza (`fakeEnabled`, `reorgFakeEnabled`,
 *      `suggestFakeEnabled`, que ya se apagan solas en producción).
 *   2. Si no, la clave del proveedor que ha elegido el centro.
 *   3. `gastaIa` solo es verdad con clave y sin simular. Es lo que decide si la
 *      ruta llama a `vetoAi`.
 *
 * ── POR QUÉ `vetoAi` SOLO CUANDO SE VA A GASTAR ───────────────────────────
 * Las tres rutas llamaban a `vetoAi` lo primero. Sin clave (o en una demo) no
 * se gastaba nada, pero igual quedaba un `ai.uso` en `master.audit_logs` —las
 * demos entran como admin: una fila por visitante en master, que el reseteo de
 * la demo no limpia— y, en un centro con el candado puesto, se creaba una
 * solicitud de permiso y se avisaba a dirección por una IA que no iba a
 * llamarse.
 *
 * ── POR QUÉ `demoForcesFakeAi` Y NO EL SLUG «demo» A MANO ─────────────────
 * Eran las tres últimas comparaciones del slug con «demo»: las demos por oficio
 * (`demo_clinica`, `demo_nutricion`, `demo_agencia`) contestaban «sin IA» en
 * vez de enseñar el modo simulado. `lib/demo/isDemo.js` cubre a las cuatro.
 *
 * Las rutas que sin clave responden 503 (no tienen sustituto) no usan esto.
 * Sin base de datos ni Next: se prueba en `scripts/_smoke-salamandrobot-turno.mjs`.
 */
import { demoForcesFakeAi } from "../demo/isDemo.js";
import { getTenantIaKey, getTenantIaModel } from "./proveedorIa.js";

/**
 * @param ctx  contexto del tenant
 * @param opts.simuladoPorEntorno  lo que diga el `fakeEnabled()` de la pieza
 * @returns {{ simulado: boolean, apiKey: string|null, model: string, gastaIa: boolean }}
 */
export function modoDeIa(ctx, { simuladoPorEntorno = false } = {}) {
  const simulado = demoForcesFakeAi(ctx) || simuladoPorEntorno === true;
  const apiKey = simulado ? null : getTenantIaKey(ctx);
  return { simulado, apiKey, model: getTenantIaModel(ctx), gastaIa: !!apiKey };
}
