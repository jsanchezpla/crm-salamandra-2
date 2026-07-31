/**
 * Retención de tarjeta: autorizar ahora, cobrar después.
 *
 * Es la pieza del flujo "el paciente deja la tarjeta al reservar y se le cobra
 * cuando la profesional confirma". Convive con `checkout.js` (cobro inmediato),
 * que sigue sirviendo a quien cobre por adelantado; no lo sustituye.
 *
 * ── LA MISMA REGLA DE SEGURIDAD QUE checkout.js ──────────────────────────────
 * Esto es LIBRERÍA de servidor, no un endpoint. El importe lo calcula siempre
 * quien cobra, a partir de SUS datos (`EventType.price`), y nunca llega del
 * cliente. Un endpoint público con `amount` en el body dejaría pagar un céntimo
 * por una consulta.
 *
 * ── SOLO TARJETA, Y NO ES UNA SIMPLIFICACIÓN ─────────────────────────────────
 * `payment_method_types: ["card"]` está puesto a conciencia: Bizum, SEPA e iDEAL
 * NO admiten captura manual (la documentación de Stripe lo marca literalmente
 * como "Manual capture support: No"). Si se dejara que Stripe ofreciera los
 * métodos activados en el panel del tenant —como sí hace `checkout.js`— el
 * paciente vería Bizum, lo elegiría, y la petición fallaría o cobraría al
 * instante rompiendo la promesa de "no se te cobra hasta que se confirme".
 * Quien quiera aceptar Bizum necesita otro flujo, no este.
 *
 * ── LO QUE ESTE MÓDULO NO SABE ───────────────────────────────────────────────
 * Cuándo caduca la retención. El plazo real (`capture_before`) lo dice Stripe en
 * el CHARGE, y el charge no existe hasta que el paciente confirma la tarjeta en
 * el navegador. Por eso `authorizationExpiresAt` lo escribe el webhook al
 * recibir `payment_intent.amount_capturable_updated`, no esta función. Calcular
 * el plazo por nuestra cuenta ("creado + 7 días") es cómo se pierden
 * autorizaciones: depende de la red de la tarjeta y del tipo de operación.
 */

import { assertNotDemoPaidCall } from "../demo/isDemo.js";
// `errorTypes.js` en vez de `errors.js`: sin Next detrás, para que este módulo
// se pueda ejercitar desde un script de pruebas (ver scripts/_smoke-autorizacion.mjs).
import { ValidationError } from "../utils/errorTypes.js";
import { getStripe, getTenantStripeConfig } from "./stripeConfig.js";

/**
 * Cuánto tiempo se le da al paciente para teclear la tarjeta.
 *
 * OJO: esto NO es el reloj del dinero. Solo protege el HUECO mientras rellena el
 * formulario; el reloj del dinero es `authorizationExpiresAt` y dura días. Antes
 * había un solo reloj de 45 min porque el pago ocurría entero en esa ventana;
 * ahora son dos cosas distintas y confundirlas libera huecos de citas vivas.
 *
 * 20 minutos: de sobra para buscar la tarjeta y pasar el 3D Secure del banco
 * (que puede tardar en llegar por SMS), y poco para que un abandono deje la hora
 * bloqueada media tarde.
 */
export const VENTANA_TARJETA_MS = 20 * 60 * 1000;

/**
 * Saca de un cargo de Stripe CUÁNDO CADUCA la retención.
 *
 * ── DÓNDE VIVE ESE DATO, QUE NO ES DONDE PARECE ──────────────────────────────
 * No es `charge.capture_before`. Está anidado en
 * `charge.payment_method_details.card.capture_before`, y es un epoch en SEGUNDOS.
 * Comprobado empíricamente contra Stripe (scripts/_probe-capture-before.mjs)
 * porque la primera versión de esto lo leía del nivel de arriba, se encontraba
 * `undefined` y se quedaba tan tranquila: el resultado habría sido no saber
 * nunca cuándo caduca una retención y perderlas en silencio.
 *
 * Existe una sola función para leerlo a propósito. Si mañana Stripe lo mueve,
 * se arregla aquí y no en los tres sitios que lo necesitan.
 *
 * Devuelve null si no viene (métodos sin caducidad conocida): quien llame decide
 * qué hacer, pero NUNCA debe inventarse un plazo por su cuenta.
 */
export function leerCaducidadAutorizacion(charge) {
  const epoch = charge?.payment_method_details?.card?.capture_before;
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000);
}

/**
 * ¿Puede este tenant retener tarjetas?
 *
 * Exige la clave PUBLICABLE además de las dos de `getTenantStripeConfig`. Con el
 * checkout redirigido era opcional (Stripe alojaba el formulario), pero aquí el
 * formulario se pinta en nuestra página con Stripe.js y sin ella no hay nada que
 * mostrar. Se comprueba ANTES de crear ninguna fila para no dejar reservas a
 * medias esperando un formulario que nunca podrá cargarse.
 */
export function tenantPuedeAutorizar(ctx) {
  const cfg = getTenantStripeConfig(ctx);
  return !!(cfg.configured && cfg.publishableKey);
}

/**
 * Crea la retención: fila propia + PaymentIntent en Stripe listo para que el
 * navegador lo confirme con el Payment Element.
 *
 * Devuelve el `clientSecret` (que el front necesita) y la clave publicable. NO
 * hay dinero retenido todavía al volver de aquí: el PaymentIntent nace en
 * `requires_payment_method` y solo pasa a `requires_capture` cuando el paciente
 * confirma la tarjeta. Quien llame no debe dar la reserva por buena hasta que lo
 * diga el webhook.
 *
 * @param {object} ctx  tenantContext
 * @param {object} opts
 * @param {string} opts.entityType   "booking" | "order" | ...
 * @param {string} opts.entityId     UUID de la entidad
 * @param {number} opts.amount       CÉNTIMOS (entero > 0), calculado en servidor
 * @param {string} [opts.currency]   por defecto "eur"
 * @param {string} opts.description  lo que verá el titular en su banco
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]
 * @returns {Promise<{paymentSession: object, clientSecret: string, publishableKey: string}>}
 */
export async function autorizarPago(ctx, opts) {
  const {
    entityType,
    entityId,
    amount,
    currency = "eur",
    description,
    customerEmail = null,
    metadata = {},
  } = opts ?? {};

  // La demo da sesión de admin a visitantes anónimos: nunca debe retener dinero
  // de nadie. Esta llamada tiene que estar en TODAS las funciones de este módulo
  // y no solo en una: el guard vivía únicamente dentro de `createCheckoutSession`
  // y este flujo no pasa por ahí.
  assertNotDemoPaidCall(ctx, "La retención de tarjeta");

  if (!entityType || !entityId) throw new ValidationError("entityType y entityId son obligatorios");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("El importe debe ser un número entero de céntimos mayor que cero");
  }

  const cfg = getTenantStripeConfig(ctx);
  if (!cfg.configured) {
    throw new ValidationError(
      "Este profesional no tiene configurado el cobro online. Avísale para que lo active."
    );
  }
  if (!cfg.publishableKey) {
    throw new ValidationError(
      "Falta la clave publicable de Stripe: sin ella no se puede mostrar el formulario de tarjeta."
    );
  }

  const { PaymentSession } = ctx.tenantModels;

  // 1) Fila propia PRIMERO: si Stripe falla, queda el rastro del intento.
  const paymentSession = await PaymentSession.create({
    entityType,
    entityId,
    amount,
    currency,
    description: description ?? null,
    status: "authorizing",
    metadata,
  });

  // 2) PaymentIntent con captura manual. La clave de idempotencia es el id de
  //    nuestra fila: si esto se reintenta (timeout, doble clic), Stripe devuelve
  //    EL MISMO intent en vez de retener el dinero dos veces.
  const stripe = await getStripe(ctx);
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        capture_method: "manual",
        // Ver la nota de la cabecera: solo tarjeta, porque el resto de métodos
        // no admiten captura manual.
        payment_method_types: ["card"],
        description: description || undefined,
        receipt_email: customerEmail || undefined,
        metadata: {
          paymentSessionId: paymentSession.id,
          tenantSlug: ctx.slug,
          entityType,
          entityId,
        },
      },
      { idempotencyKey: `auth:${paymentSession.id}` }
    );
  } catch (err) {
    await paymentSession.update({
      status: "failed",
      metadata: { ...metadata, error: String(err?.message ?? err).slice(0, 300) },
    });
    throw err;
  }

  await paymentSession.update({ stripePaymentIntentId: intent.id });

  return {
    paymentSession,
    clientSecret: intent.client_secret,
    publishableKey: cfg.publishableKey,
  };
}

/**
 * Captura el dinero retenido. Es el momento en que el cobro ocurre de verdad.
 *
 * Vuelve a leer el PaymentIntent en Stripe antes de capturar en vez de fiarse de
 * lo que dice nuestra fila: entre que se autorizó y ahora pueden haber pasado
 * días, y la autorización puede haber caducado, haberse cancelado desde el panel
 * de Stripe o haberse capturado ya. Nuestra base de datos es una copia, y la
 * verdad del dinero está en Stripe.
 *
 * Lanza con `.code` para que el llamante distinga qué decirle a la profesional:
 *   · YA_CAPTURADO   → no es un error: alguien se adelantó. Trátalo como éxito.
 *   · CADUCADA       → hay que volver a pedir la tarjeta al paciente
 *   · SIN_RETENCION  → nunca llegó a autorizarse
 *   · RECHAZADA      → el banco dijo que no al capturar
 *
 * @returns {Promise<{intent: object, importe: number}>}
 */
export async function capturarPago(ctx, paymentSession, opts = {}) {
  assertNotDemoPaidCall(ctx, "El cobro");

  const pi = paymentSession?.stripePaymentIntentId;
  if (!pi) {
    const e = new Error("Esta reserva no tiene ninguna retención asociada");
    e.code = "SIN_RETENCION";
    throw e;
  }

  const stripe = await getStripe(ctx);
  if (!stripe) throw new ValidationError("Stripe no está configurado para este cliente");

  const actual = await stripe.paymentIntents.retrieve(pi);

  if (actual.status === "succeeded") {
    const e = new Error("Esta retención ya se había cobrado");
    e.code = "YA_CAPTURADO";
    e.intent = actual;
    throw e;
  }
  if (actual.status === "canceled") {
    // Un PaymentIntent cancelado (por caducidad o a mano) queda MUERTO: no se
    // puede capturar ni reutilizar. La salida es autorizar de cero.
    const e = new Error("La retención ha caducado o se canceló; hay que volver a pedir la tarjeta");
    e.code = "CADUCADA";
    throw e;
  }
  if (actual.status !== "requires_capture") {
    const e = new Error(`La tarjeta no llegó a retenerse (estado: ${actual.status})`);
    e.code = "SIN_RETENCION";
    e.estado = actual.status;
    throw e;
  }

  // Sin `amount_to_capture`: se cobra lo autorizado. Capturar de menos LIBERA
  // automáticamente el resto y no se puede volver a capturar sobre la misma
  // autorización, así que no se hace por accidente.
  let intent;
  try {
    intent = await stripe.paymentIntents.capture(pi, {}, {
      idempotencyKey: `capture:${paymentSession.id}`,
    });
  } catch (err) {
    const e = new Error(err?.message || "El banco rechazó el cobro");
    e.code = "RECHAZADA";
    e.stripeCode = err?.code ?? null;
    // El motivo real de una tarjeta perdida o robada NUNCA se enseña al
    // paciente: Stripe obliga a presentarlo como un rechazo genérico.
    throw e;
  }

  const importe = Number.isInteger(intent.amount_received)
    ? intent.amount_received
    : paymentSession.amount;

  await paymentSession.update({
    status: "paid",
    paidAt: new Date(),
    metadata: { ...(paymentSession.metadata ?? {}), capturadoPor: opts.porQuien ?? null },
  });

  return { intent, importe };
}

/**
 * Suelta el dinero retenido sin cobrar nada. Es lo que hay que hacer al rechazar
 * una solicitud o al cancelarla antes de confirmarla.
 *
 * No confundir con un reembolso: aquí no ha habido cobro, así que no hay comisión
 * ni movimiento que devolver. El dinero deja de estar apartado y punto (cuándo lo
 * ve el titular otra vez depende de su banco, así que no se le promete un plazo).
 *
 * Es idempotente y no lanza si ya estaba suelto: quien rechaza una cita no debe
 * ver un error porque la retención hubiera caducado sola.
 */
export async function liberarAutorizacion(ctx, paymentSession, opts = {}) {
  assertNotDemoPaidCall(ctx, "La liberación de la retención");

  const pi = paymentSession?.stripePaymentIntentId;
  if (!pi) return { liberada: false, motivo: "sin retención" };

  const stripe = await getStripe(ctx);
  if (!stripe) return { liberada: false, motivo: "Stripe no configurado" };

  const actual = await stripe.paymentIntents.retrieve(pi);

  if (actual.status === "canceled") {
    await paymentSession.update({ status: "void" });
    return { liberada: false, motivo: "ya estaba liberada" };
  }
  if (actual.status === "succeeded") {
    // Ya se cobró: esto no se suelta, se devuelve. Se avisa al llamante para que
    // use `refundPayment` en vez de dar por hecho que no había dinero.
    const e = new Error("Esta retención ya se cobró: para deshacerla hay que devolver el dinero");
    e.code = "YA_CAPTURADO";
    throw e;
  }

  await stripe.paymentIntents.cancel(
    pi,
    { cancellation_reason: opts.razonStripe ?? "abandoned" },
    { idempotencyKey: `void:${paymentSession.id}` }
  );

  await paymentSession.update({
    status: "void",
    metadata: { ...(paymentSession.metadata ?? {}), motivoLiberacion: opts.motivo ?? null },
  });

  return { liberada: true };
}
