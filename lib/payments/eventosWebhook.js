/**
 * Los eventos de Stripe que el webhook del CRM trata, declarados UNA vez.
 *
 * ── POR QUÉ ESTE FICHERO EXISTE ──────────────────────────────────────────────
 * La misma lista se necesita en tres sitios que no se hablan entre ellos:
 *
 *   · `app/api/webhooks/stripe/[tenantSlug]/route.js` — el que los procesa;
 *   · `modules/config/ConfigModule.jsx` — la tarjeta que le dice al cliente qué
 *     marcar al crear su punto de conexión en Stripe;
 *   · `scripts/comprobar-stripe.js` — el que va a Stripe y comprueba que están.
 *
 * Cuando la lista se copia, diverge: hasta el 20/08/2026 la pantalla pedía
 * cinco eventos (los de `checkout.session.*` y `charge.refunded`) de los once
 * que el webhook trata. No mordió a nadie porque el único cliente con Stripe
 * —nutri_laura— tenía su webhook dado de alta a mano con la lista buena; el
 * siguiente que lo configurara siguiendo la pantalla se quedaba sin los de
 * `payment_intent.*` (la cita nunca entra en la lista de espera) y sin los de
 * `invoice.*` (las cuotas 2ª en adelante se cobran sin que el CRM se entere).
 *
 * La fuente de verdad es lo que el webhook TRATA, no esta lista: si añades un
 * `case` allí y no lo declaras aquí, `_smoke-stripe-eventos.mjs` se pone rojo.
 *
 * `porque` se lee tal cual en la pantalla del cliente y en la salida del
 * script: se escribe para quien está delante del panel de Stripe decidiendo si
 * marcar esa casilla, no para quien mantiene este fichero.
 */

/** Ordenados por flujo: primero la retención, que es la que más duele perder. */
export const EVENTOS_WEBHOOK_STRIPE = [
  {
    evento: "payment_intent.amount_capturable_updated",
    porque: "la tarjeta ha quedado retenida: SIN ESTE la cita no entra en la lista de espera",
  },
  { evento: "payment_intent.succeeded", porque: "la retención se ha cobrado de verdad" },
  { evento: "payment_intent.canceled", porque: "la retención se ha soltado sin llegar a cobrar" },
  { evento: "payment_intent.payment_failed", porque: "el banco ha rechazado la tarjeta" },
  {
    evento: "checkout.session.completed",
    porque: "se ha pagado un bono, o la primera cuota de un pago a plazos",
  },
  {
    evento: "checkout.session.async_payment_succeeded",
    porque: "un pago de liquidación diferida (SEPA y parecidos) ha entrado por fin",
  },
  {
    evento: "checkout.session.async_payment_failed",
    porque: "ese pago diferido acabó fallando: se libera el hueco",
  },
  {
    evento: "checkout.session.expired",
    porque: "el pago se abandonó y caducó: se retira la reserva de la lista de espera",
  },
  { evento: "charge.refunded", porque: "se ha devuelto dinero desde el panel de Stripe" },
  {
    evento: "invoice.paid",
    porque:
      "una cuota del pago a plazos se ha cobrado: SIN ESTE las cuotas siguientes se cobran sin que el CRM se entere",
  },
  { evento: "invoice.payment_failed", porque: "una cuota del pago a plazos la ha rechazado el banco" },
];
