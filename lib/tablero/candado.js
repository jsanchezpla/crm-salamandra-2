/**
 * lib/tablero/candado.js — los tres candados del Registro, en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: la misma comprobación estaba escrita en
 * `app/api/admin/tablero/route.js` y hacía falta otra vez en los dos endpoints
 * nuevos del 24/08/2026 —escribir tareas y subir capturas—. Tres copias de un
 * control de acceso es como se llega a que una de ellas se quede sin el tercer
 * `if`: la que sirve un fichero con datos de un paciente dentro.)
 *
 * Los tres, y por qué cada uno:
 *
 *   · `provisioning` — es el módulo que solo tiene `salamandra_solutions`. Este
 *     panel no es de ningún cliente.
 *   · rol admin — leído fresco de BD por `withTenant`, que reescribe
 *     `x-user-role` antes del handler; degradar a alguien surte efecto al
 *     instante.
 *   · no demo — las cuatro demos son PÚBLICAS y dan sesión de admin a
 *     cualquiera (`lib/demo/isDemo.js`). Sin este tercero, el Registro entero
 *     —con los nombres de los clientes y lo que falla en cada uno— se serviría a
 *     un visitante anónimo.
 */

import { forbidden } from "../utils/apiResponse.js";
import { isDemoTenant } from "../demo/isDemo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** `null` si puede pasar; si no, la respuesta que hay que devolver tal cual. */
export function candadoTablero(ctx) {
  if (!ctx.hasModule("provisioning"))
    return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}
