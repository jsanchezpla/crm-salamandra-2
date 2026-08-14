/**
 * _fake-stripe-hooks.mjs — el gancho de resolución que usa `_fake-stripe-loader.mjs`.
 *
 * Corre en el hilo de los cargadores de Node, aparte de la aplicación. Lo único
 * que hace es: cuando alguien pida el paquete `stripe`, darle nuestro
 * `_fake-stripe.mjs`. Cualquier otro import sigue su camino normal.
 */

const FALSO = new URL("./_fake-stripe.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "stripe") {
    return { url: FALSO, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
