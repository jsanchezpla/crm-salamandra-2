import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../lib/tenant/publicTenantContext.js";
import { getStripe, getTenantStripeConfig } from "../../../../../lib/payments/stripeConfig.js";
import {
  onEntityPaid,
  onEntityPaymentFailed,
  onEntityPaymentPending,
  onEntityRefunded,
} from "../../../../../lib/payments/entityHooks.js";

/**
 * POST /api/webhooks/stripe/[tenantSlug]
 *
 * Confirmación de cobros y devoluciones desde Stripe.
 *
 * ── POR QUÉ EL TENANT VA EN LA URL ────────────────────────────────────────────
 * Stripe no manda ninguna cabecera de tenant, y aunque la mandara no habría que
 * fiarse: el 2026-07-26 se corrigió en este mismo CRM un fallo de suplantación
 * cross-tenant en los webhooks de TutorLMS, precisamente porque el tenant destino
 * viajaba en una cabecera que controlaba quien llamaba. Aquí el slug está en la
 * RUTA, y la firma se verifica con el `stripeWebhookSecret` DE ESE tenant: una
 * petición firmada con las claves de otro no valida. Cada tenant configura en su
 * panel de Stripe su propia URL con su slug.
 *
 * ── IDEMPOTENCIA (atómica) ───────────────────────────────────────────────────
 * Stripe garantiza entrega "al menos una vez" y reintenta hasta 3 días.
 *
 * La marca del evento y su procesado van en LA MISMA TRANSACCIÓN:
 *   · Si todo va bien, se confirman juntos → un reintento choca con el UNIQUE de
 *     `stripe_event_id` y se responde 200 sin repetir el trabajo.
 *   · Si algo falla, la transacción se deshace ENTERA — incluida la marca — así que
 *     el reintento de Stripe vuelve a encontrar el evento sin procesar y funciona.
 *
 * Antes esto se hacía en dos pasos (marcar → procesar → borrar la marca si falla),
 * y tenía un agujero real: si la base de datos estaba caída, fallaba el procesado
 * Y fallaba el borrado de la marca. El evento quedaba marcado como visto sin
 * haberse procesado, y todos los reintentos posteriores respondían "duplicado".
 * Resultado: cliente cobrado y cita sin confirmar, en silencio. Con la transacción
 * eso no puede pasar: o se guarda todo, o no se guarda nada.
 *
 * Se responde 200 a lo procesado y a lo ignorado; 400 a firma inválida; 500 a
 * fallo transitorio (para que Stripe reintente).
 */
export const POST = withPublicTenant(
  async (request, _ctx, tenantContext) => {
    const { tenantModels, slug } = tenantContext;
    const { PaymentSession, StripeWebhookEvent } = tenantModels;

    const { webhookSecret } = getTenantStripeConfig(tenantContext);
    if (!webhookSecret) {
      // Sin secreto no se puede verificar nada: se rechaza (no se procesa a ciegas).
      return NextResponse.json({ ok: false, error: "Pagos no configurados" }, { status: 400 });
    }

    // Cuerpo CRUDO: la firma se calcula sobre los bytes exactos.
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");

    const stripe = await getStripe(tenantContext);
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 400 });
    }

    // Comprobación extra: el evento debe decir que es de este tenant. Defensa en
    // profundidad por si alguien reenvía a otra URL un evento legítimo.
    const evTenant = event?.data?.object?.metadata?.tenantSlug;
    if (evTenant && evTenant !== slug) {
      return NextResponse.json({ ok: true, ignored: "tenant-mismatch" });
    }

    // ── Marcar + procesar, todo o nada ───────────────────────────────────────
    try {
      let postCommit = null;
      const outcome = await tenantContext.tenantSequelize.transaction(async (t) => {
        const claim = await StripeWebhookEvent.create(
          { stripeEventId: event.id, type: event.type },
          { transaction: t }
        );
        const res = await procesar(tenantContext, { PaymentSession, event, t });
        postCommit = res?.postCommit ?? null;
        const texto = typeof res === "string" ? res : (res?.outcome ?? "ok");
        await claim.update({ outcome: texto.slice(0, 255) }, { transaction: t });
        return texto;
      });

      // Efectos hacia FUERA (correos) solo con la transacción ya confirmada: si
      // se hubieran hecho dentro y algo fallara, habríamos avisado al cliente de
      // una confirmación que en la base de datos no existe. Best-effort: que
      // falle el correo no debe hacer que Stripe reintente un cobro ya procesado.
      if (postCommit) {
        try {
          await postCommit();
        } catch (mailErr) {
          process.stderr.write(`[stripe:webhook] postCommit falló (${slug}): ${mailErr.message}\n`);
        }
      }

      return NextResponse.json({ ok: true, outcome });
    } catch (err) {
      // Ya procesado antes: reintento de Stripe. No se repite el trabajo.
      if (err?.name === "SequelizeUniqueConstraintError") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      // Fallo transitorio: la transacción se deshizo (la marca incluida), así que
      // el reintento de Stripe podrá procesarlo.
      process.stderr.write(`[stripe:webhook] ${slug} ${event.type}: ${err.message}\n`);
      return NextResponse.json({ ok: false, error: "Error procesando el evento" }, { status: 500 });
    }
  },
  // Stripe puede entregar ráfagas; un límite bajo tiraría eventos legítimos. La
  // firma ya es la barrera real.
  { rateLimit: { limit: 300, windowMs: 60_000, key: "stripe-webhook" } }
);

async function procesar(ctx, { PaymentSession, event, t }) {
  const obj = event.data.object;

  switch (event.type) {
    // `completed` se emite en cuanto el cliente TERMINA el checkout, que no es lo
    // mismo que haber pagado. `async_payment_succeeded` es su pareja para los
    // métodos de liquidación diferida. Comparten rama porque, una vez hay dinero,
    // el tratamiento es idéntico.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        checkoutSessionId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (ps.status === "paid" || ps.status === "refunded") return "ya estaba pagada";

      // ── ¿HAY DINERO DE VERDAD? ────────────────────────────────────────────
      // Con métodos de liquidación diferida (SEPA, Multibanco, Boleto…) este
      // evento llega con `payment_status: 'unpaid'` y el cobro se resuelve días
      // después. Confirmar aquí sería dar la cita por buena y mandarle al
      // paciente un email de confirmación de un pago que todavía no existe —y
      // que puede acabar fallando—.
      //
      // Se falla del lado seguro: si el campo no viene, se trata como NO pagado.
      // Stripe siempre lo manda en una checkout.session; su ausencia significa
      // que el evento no es lo que creemos, y confiar sale caro.
      const cobrado =
        obj?.payment_status === "paid" || obj?.payment_status === "no_payment_required";
      if (!cobrado) {
        return await onEntityPaymentPending(ctx, ps, t);
      }

      // El importe cobrado debe coincidir con el que guardamos. Si no, no se marca
      // como pagada: es señal de manipulación o de un precio cambiado a mitad.
      if (Number.isInteger(obj.amount_total) && obj.amount_total !== ps.amount) {
        process.stderr.write(
          `[stripe:webhook] importe distinto ps=${ps.id} esperado=${ps.amount} recibido=${obj.amount_total}\n`
        );
        return "importe no coincide";
      }

      await ps.update({
        status: "paid",
        paidAt: new Date(),
        stripePaymentIntentId: typeof obj.payment_intent === "string" ? obj.payment_intent : null,
      }, { transaction: t });
      return await onEntityPaid(ctx, ps, t);
    }

    // El cobro diferido acabó fallando: ni dinero, ni cita. Se libera el hueco.
    case "checkout.session.async_payment_failed": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        checkoutSessionId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (ps.status === "paid" || ps.status === "refunded") {
        return "la sesión consta pagada — no se toca";
      }
      await ps.update({ status: "failed" }, { transaction: t });
      return await onEntityPaymentFailed(ctx, ps, t);
    }

    case "checkout.session.expired": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        checkoutSessionId: obj?.id,
      }, t);
      if (!ps || ps.status !== "pending") return "no aplica";
      await ps.update({ status: "expired" }, { transaction: t });
      return "marcada como caducada";
    }

    case "charge.refunded": {
      // Devolución hecha desde el panel de Stripe (fuera del CRM).
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      if (!pi) return "sin payment_intent";
      const ps = await PaymentSession.findOne({ where: { stripePaymentIntentId: pi }, transaction: t });
      if (!ps || ps.status === "refunded") return "no aplica";
      await ps.update({
        status: "refunded",
        refundAmount: Number.isInteger(obj.amount_refunded) ? obj.amount_refunded : ps.amount,
        refundedAt: new Date(),
        refundReason: ps.refundReason ?? "devuelto desde Stripe",
      }, { transaction: t });
      return await onEntityRefunded(ctx, ps, t);
    }

    default:
      return `evento ignorado (${event.type})`;
  }
}

function buscarSesion(PaymentSession, { id, checkoutSessionId }, t) {
  if (id) return PaymentSession.findByPk(id, { transaction: t });
  if (checkoutSessionId) {
    return PaymentSession.findOne({ where: { stripeCheckoutSessionId: checkoutSessionId }, transaction: t });
  }
  return null;
}
