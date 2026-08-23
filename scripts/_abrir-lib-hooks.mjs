/**
 * _abrir-lib-hooks.mjs — el gancho de resolución que usa `_abrir-lib.mjs`.
 *
 * Corre en el hilo de los cargadores de Node, aparte de la aplicación. Lo único
 * que hace es completar la extensión que le falta a `next/server`. Cualquier
 * otro import sigue su camino normal.
 *
 * Se resuelve al fichero REAL de Next (`next/server.js`, que existe y se importa
 * limpiamente), no a un sustituto inventado: lo que se ejercita después es el
 * `NextResponse` de producción, con sus cabeceras y sus códigos de estado.
 */

// `next/server` a secas y también `next/server` pedido desde dentro de otro
// paquete: la lista se queda en lo justo a propósito. Un gancho que reescribe
// más de la cuenta hace que un script pruebe algo que no es lo que corre.
const A_COMPLETAR = new Map([["next/server", "next/server.js"]]);

export async function resolve(specifier, context, nextResolve) {
  const conExtension = A_COMPLETAR.get(specifier);
  if (conExtension) return nextResolve(conExtension, context);
  return nextResolve(specifier, context);
}
