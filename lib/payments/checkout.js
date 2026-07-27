/**
 * Creación de sesiones de cobro (Stripe Checkout).
 *
 * ── DECISIÓN DE SEGURIDAD IMPORTANTE ──────────────────────────────────────────
 * Esto es una función de LIBRERÍA que se llama desde el servidor, NO un endpoint
 * público que reciba el importe. El importe lo calcula siempre el módulo que cobra
 * a partir de SUS datos (p. ej. `EventType.price`), nunca llega del cliente.
 *
 * Si expusiéramos un endpoint público con `amount` en el body, cualquiera podría
 * pagar 1 céntimo por una consulta. Por eso el flujo es:
 *     POST /book  →  (servidor) lee el precio  →  createCheckoutSession()  →  URL
 *
 * ── CADUCIDAD ────────────────────────────────────────────────────────────────
 * La sesión de Stripe caduca a los 30 min (es el mínimo que permite Stripe). La
 * reserva provisional que bloquea el hueco debe usar EXACTAMENTE la misma ventana:
 * si el hueco se liberase antes, alguien podría pagar por un hueco ya reasignado.
 */

import { assertNotDemoPaidCall } from "../demo/isDemo.js";
import { ValidationError } from "../utils/errors.js";
import { getStripe, getTenantStripeConfig } from "./stripeConfig.js";

/** Ventana de caducidad del cobro. 30 min = mínimo que acepta Stripe Checkout. */
export const CHECKOUT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Margen que el hueco sigue reservado DESPUÉS de que la sesión de Stripe caduque.
 *
 * La cabecera de arriba decía que ambas ventanas debían ser iguales, y estaba
 * mal: iguales no basta. Alguien puede pagar en el último segundo de la sesión y
 * que su webhook llegue con retraso (reintento de Stripe, deploy a medias, hipo
 * de red). Si el hueco ya se hubiera liberado, para entonces podría estar vendido
 * a otra persona — y tendríamos dos pacientes pagando la misma hora.
 *
 * El coste de pasarse es un hueco bloqueado 15 minutos de más. El de quedarse
 * corto es cobrar dos veces. No es una elección difícil.
 */
export const HOLD_EXTRA_MS = 15 * 60 * 1000;

/** Cuánto bloquea el hueco una reserva provisional. Siempre > CHECKOUT_WINDOW_MS. */
export const HOLD_WINDOW_MS = CHECKOUT_WINDOW_MS + HOLD_EXTRA_MS;

/**
 * @param {object} ctx        tenantContext (de getTenantContext / withPublicTenant)
 * @param {object} opts
 * @param {string} opts.entityType   "booking" | "order" | ...
 * @param {string} opts.entityId     UUID de la entidad que se paga
 * @param {number} opts.amount       CÉNTIMOS (entero > 0). Calculado en servidor.
 * @param {string} [opts.currency]   por defecto "eur"
 * @param {string} opts.description  lo que verá el cliente en Stripe
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]
 * @param {Date}   [opts.expiresAt]  cuándo caduca la sesión. Lo pasa el llamante
 *   cuando necesita que su propia reserva y la de Stripe hablen del MISMO
 *   instante: si cada uno hace su `Date.now()`, el de Stripe siempre sale más
 *   tarde (se calcula después) y la ventana de pago acaba sobrepasando al hueco.
 * @returns {Promise<{ paymentSession: object, checkoutUrl: string, expiresAt: Date }>}
 */
export async function createCheckoutSession(ctx, opts) {
  const {
    entityType,
    entityId,
    amount,
    currency = "eur",
    description,
    successUrl,
    cancelUrl,
    customerEmail = null,
    metadata = {},
    expiresAt: expiresAtOpt = null,
  } = opts ?? {};

  // La demo da sesión de admin a visitantes anónimos: nunca debe cobrar de verdad.
  assertNotDemoPaidCall(ctx, "El pago");

  if (!entityType || !entityId) throw new ValidationError("entityType y entityId son obligatorios");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("El importe debe ser un número entero de céntimos mayor que cero");
  }
  if (!successUrl || !cancelUrl) throw new ValidationError("successUrl y cancelUrl son obligatorios");

  const { configured } = getTenantStripeConfig(ctx);
  if (!configured) {
    throw new ValidationError(
      "Este profesional no tiene configurado el cobro online. Avísale para que lo active."
    );
  }

  const { PaymentSession } = ctx.tenantModels;

  // Stripe exige que `expires_at` esté al menos 30 min por delante de SU reloj.
  // El llamante nos pasa el instante que pactó con su propia reserva, pero entre
  // que lo calculó y llegamos aquí ha pasado tiempo (la transacción que reserva
  // el hueco, la latencia de red, un desfase de relojes). Si se quedara corto,
  // Stripe devolvería 400 y NADIE podría pagar. Se sube al mínimo con un minuto
  // de colchón; el hold del llamante lleva margen de sobra para cubrirlo.
  const suelo = new Date(Date.now() + CHECKOUT_WINDOW_MS + 60_000);
  const expiresAt = expiresAtOpt && expiresAtOpt > suelo ? expiresAtOpt : suelo;

  // 1) Fila propia PRIMERO: si Stripe falla, queda el rastro del intento.
  const paymentSession = await PaymentSession.create({
    entityType,
    entityId,
    amount,
    currency,
    description: description ?? null,
    status: "pending",
    metadata,
  });

  // 2) Sesión en Stripe. La clave de idempotencia es el id de nuestra fila: si esta
  //    llamada se reintenta (timeout de red, doble clic), Stripe devuelve LA MISMA
  //    sesión en vez de crear otra — y por tanto no se puede cobrar dos veces.
  const stripe = await getStripe(ctx);
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Sin `payment_method_types`: así se usan los métodos que el tenant tenga
        // activados en su panel de Stripe (tarjeta, Klarna, Bizum…). Activar uno
        // nuevo no requiere tocar este código.
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amount,
              product_data: { name: description || "Servicio" },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customerEmail || undefined,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        // El webhook usa esto para saber qué fila actualizar. `tenantSlug` viaja
        // como comprobación extra de que el evento es de quien decimos.
        metadata: {
          paymentSessionId: paymentSession.id,
          tenantSlug: ctx.slug,
          entityType,
          entityId,
        },
      },
      { idempotencyKey: `checkout:${paymentSession.id}` }
    );
  } catch (err) {
    await paymentSession.update({
      status: "failed",
      metadata: { ...metadata, error: String(err?.message ?? err).slice(0, 300) },
    });
    throw err;
  }

  await paymentSession.update({ stripeCheckoutSessionId: session.id });

  return { paymentSession, checkoutUrl: session.url, expiresAt };
}
