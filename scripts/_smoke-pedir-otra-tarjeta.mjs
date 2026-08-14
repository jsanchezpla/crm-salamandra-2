/**
 * _smoke-pedir-otra-tarjeta.mjs — la guarda del botón «pedirle otra tarjeta».
 *
 * Ejercita `estorbaParaPedirOtraTarjeta` de lib/citas/cobroCita.js, que es la
 * comprobación ESTRECHA que sustituyó a `tieneRetencionPendiente` en ese botón
 * (y solo en ese botón: la lista ancha no se tocó, sus otros cuatro
 * consumidores la quieren así).
 *
 * Lo que se comprueba, caso por caso:
 *
 *   1. `authorized`  → estorba. Hay una retención sana: lo que toca es confirmar.
 *   2. `capturing`   → estorba, por lo mismo.
 *   3. `void`        → NO estorba. Es el caso de la retención caducada.
 *   4. `failed` sin PaymentSession → NO estorba: no hay nada que duplicar.
 *   5. `failed` con PaymentSession pero sin PaymentIntent → NO estorba, ídem.
 *   6. `failed` con PaymentIntent y Stripe SIN configurar → **estorba**. Es el
 *      caso de «no lo sé», y aquí no saber nunca es vía libre: crear otra
 *      retención a ciegas le dejaría al paciente el importe bloqueado dos veces.
 *
 * La distinción final `requires_capture` (viva) contra `canceled` (muerta) NO
 * está aquí, pero **ya no está sin comprobar** (14/08/2026): la cubre
 * `_smoke-retencion-viva-o-muerta.mjs`, que ejercita el camino entero —
 * `getStripe` → `leerEstadoAutorizacion` → `estorbaParaPedirOtraTarjeta` —
 * falseando solo la LIBRERÍA de Stripe (`_fake-stripe.mjs`). Así se prueban los
 * cinco desenlaces posibles sin necesitar una cuenta de Stripe, que es lo que
 * tenía este trozo parado desde el 13/08.
 *
 * Contra una cuenta de Stripe de prueba de verdad, el que manda sigue siendo
 * `_smoke-autorizacion.mjs`, que necesita un tenant con `sk_test_`.
 *
 * No toca base de datos ni red: los modelos van con dobles. Se ejecuta suelto.
 *
 * Uso:  node scripts/_smoke-pedir-otra-tarjeta.mjs
 */

import { estorbaParaPedirOtraTarjeta } from "../lib/citas/cobroCita.js";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => {
  fallos++;
  process.stderr.write(`  ✗ ${m}\n`);
};

/** Un ctx de mentira: sin Stripe configurado salvo que se diga lo contrario. */
function contexto({ sesion = null } = {}) {
  return {
    tenant: { settings: { integrations: {} } },
    tenantModels: {
      PaymentSession: {
        findByPk: async () => sesion,
        findOne: async () => sesion,
      },
    },
  };
}

async function caso(titulo, booking, ctx, esperado) {
  const r = await estorbaParaPedirOtraTarjeta(ctx, booking);
  if (r.estorba !== esperado) {
    mal(`${titulo} — esperaba estorba=${esperado} y salió ${r.estorba} (${r.mensaje ?? "sin mensaje"})`);
    return;
  }
  if (esperado && !r.mensaje) {
    mal(`${titulo} — estorba pero no dice por qué, y ese mensaje es lo único que ve la profesional`);
    return;
  }
  if (!esperado && r.mensaje) {
    mal(`${titulo} — no estorba pero devuelve mensaje: ${r.mensaje}`);
    return;
  }
  ok(`${titulo}${esperado ? ` → «${r.mensaje.slice(0, 60)}…»` : ""}`);
}

process.stdout.write("\n▶ La guarda de «pedirle otra tarjeta»\n\n");

// 1 y 2 — retención sana: no es un caso de dinero perdido.
await caso("authorized estorba", { paymentStatus: "authorized" }, contexto(), true);
await caso("capturing estorba", { paymentStatus: "capturing" }, contexto(), true);

// 3 — caducada: es justo para lo que existe el botón.
await caso("void deja pasar", { paymentStatus: "void" }, contexto(), false);

// 4 — rechazada y sin rastro de cobro: nada que duplicar.
await caso(
  "failed sin PaymentSession deja pasar",
  { paymentStatus: "failed", id: "b1", paymentSessionId: null },
  contexto({ sesion: null }),
  false
);

// 5 — hay fila de cobro, pero nunca llegó a haber PaymentIntent.
await caso(
  "failed con PaymentSession sin PaymentIntent deja pasar",
  { paymentStatus: "failed", id: "b2", paymentSessionId: "ps2" },
  contexto({ sesion: { id: "ps2", stripePaymentIntentId: null } }),
  false
);

// 6 — EL IMPORTANTE. Hay PaymentIntent que mirar y no se puede preguntar.
await caso(
  "failed con PaymentIntent y sin poder preguntar a Stripe → estorba",
  { paymentStatus: "failed", id: "b3", paymentSessionId: "ps3" },
  contexto({ sesion: { id: "ps3", stripePaymentIntentId: "pi_loquesea" } }),
  true
);

process.stdout.write(
  fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
