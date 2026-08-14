/**
 * _fake-stripe-loader.mjs — enchufa el Stripe de mentira en lugar del de verdad.
 *
 * Se carga con `--import` y lo único que hace es desviar el `import("stripe")`
 * de `lib/payments/stripeConfig.js` hacia `_fake-stripe.mjs`. Nada más se toca:
 * el resto del camino del dinero es el de producción, tal cual.
 *
 *   node --import ./scripts/_fake-stripe-loader.mjs --env-file=.env.local \
 *        scripts/_smoke-retencion-viva-o-muerta.mjs
 *
 * ⚠️ Esto NUNCA debe entrar en un arranque de verdad. Dos frenos:
 *   · el propio `_fake-stripe.mjs` se planta si le llega una clave `sk_live_`;
 *   · y esto exige `NODE_ENV !== "production"` para siquiera registrarse.
 */

import { register } from "node:module";

if (process.env.NODE_ENV === "production") {
  throw new Error("El Stripe de mentira no se carga en producción. Ni de broma.");
}

// Se pasa la URL tal cual (no una ruta): en Windows la carpeta del proyecto
// tiene un espacio y convertir de ida y vuelta a ruta lo deja mal escapado.
register(new URL("./_fake-stripe-hooks.mjs", import.meta.url));
