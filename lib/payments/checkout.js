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
  const expiresAt = new Date(Date.now() + CHECKOUT_WINDOW_MS);

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
