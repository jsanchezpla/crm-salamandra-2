import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../lib/tenant/publicTenantContext.js";
import { getStripe, getTenantStripeConfig } from "../../../../../lib/payments/stripeConfig.js";
import {
  onEntityAuthorized,
  onEntityAuthorizationVoided,
  onEntityExpired,
  onEntityPaid,
  onEntityPaymentFailed,
  onEntityPaymentPending,
  onEntityRefunded,
} from "../../../../../lib/payments/entityHooks.js";
import { leerCaducidadAutorizacion } from "../../../../../lib/payments/autorizacion.js";

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

    // ── Cuándo caduca la retención, ANTES de abrir la transacción ────────────
    // El plazo (`capture_before`) vive en el CARGO, no en el PaymentIntent, así
    // que hay que pedírselo a Stripe. Se hace aquí y no dentro de la transacción
    // a propósito: una llamada de red dentro alargaría el bloqueo de las filas
    // y, si Stripe tardara, mantendría abierta una transacción que toca la
    // agenda. Aquí fuera, lo peor que pasa es que tarde en responder.
    let caducaEn = null;
    if (event.type === "payment_intent.amount_capturable_updated") {
      try {
        const cargoId =
          typeof event.data.object?.latest_charge === "string"
            ? event.data.object.latest_charge
            : event.data.object?.latest_charge?.id;
        if (cargoId) {
          caducaEn = leerCaducidadAutorizacion(await stripe.charges.retrieve(cargoId));
        }
      } catch (err) {
        // Sin caducidad la retención sigue siendo válida; lo que se pierde es el
        // aviso previo. No se inventa un plazo: se deja en null y se registra.
        process.stderr.write(
          `[stripe:webhook] ${slug}: no se pudo leer la caducidad de la retención: ${err.message}\n`
        );
      }
    }

    // ── Marcar + procesar, todo o nada ───────────────────────────────────────
    try {
      let postCommit = null;
      const outcome = await tenantContext.tenantSequelize.transaction(async (t) => {
        const claim = await StripeWebhookEvent.create(
          { stripeEventId: event.id, type: event.type },
          { transaction: t }
        );
        const res = await procesar(tenantContext, { PaymentSession, event, t, caducaEn });
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

async function procesar(ctx, { PaymentSession, event, t, caducaEn = null }) {
  const obj = event.data.object;

  switch (event.type) {
    // ── FLUJO DE RETENCIÓN ───────────────────────────────────────────────────
    // El paciente confirmó la tarjeta y Stripe apartó el dinero SIN cobrarlo.
    // Aquí es donde la solicitud pasa a ser real y entra en la lista de espera.
    //
    // OJO con lo que este flujo NO tiene: un PaymentIntent nunca emite un evento
    // de caducidad (eso solo lo hacen las Checkout Sessions). Cuando la retención
    // muera, Stripe no avisará: hay que vigilarlo contra `capture_before`.
    case "payment_intent.amount_capturable_updated": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        paymentIntentId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (["paid", "refunded", "void"].includes(ps.status)) {
        return `la sesión ya iba por delante (${ps.status})`;
      }

      // El importe retenido tiene que ser el que pedimos. Si no cuadra, no se
      // mete en la lista de espera: se suelta, que es gratis y reversible (a
      // diferencia de un cobro, que habría que devolver).
      //
      // OJO: esto ANTES solo marcaba la fila como fallida y decía en el log que
      // se soltaba, pero no soltaba nada — el dinero se quedaba bloqueado en la
      // tarjeta de una persona hasta caducar, con la cita fuera de la lista de
      // espera y por tanto sin que nadie pudiera verla. La liberación va en
      // postCommit porque llamar a Stripe dentro de la transacción la alargaría
      // y, si se deshiciera, habríamos soltado un dinero que en la base de datos
      // sigue comprometido.
      if (Number.isInteger(obj.amount_capturable) && obj.amount_capturable !== ps.amount) {
        await ps.update({ status: "failed" }, { transaction: t });
        process.stderr.write(
          `[stripe:webhook] RETENCIÓN INESPERADA ${ctx.slug} ps=${ps.id}: esperado ${ps.amount}, retenido ${obj.amount_capturable}\n`
        );
        return {
          outcome: `importe retenido no coincide (${obj.amount_capturable} vs ${ps.amount}) — se suelta`,
          postCommit: async () => {
            const { liberarAutorizacion } = await import("../../../../../lib/payments/autorizacion.js");
            await liberarAutorizacion(ctx, ps, {
              motivo: `importe inesperado: ${obj.amount_capturable} en vez de ${ps.amount}`,
              razonStripe: "abandoned",
            });
          },
        };
      }

      await ps.update(
        {
          status: "authorized",
          stripePaymentIntentId: obj.id,
          authorizationExpiresAt: caducaEn,
        },
        { transaction: t }
      );
      return await onEntityAuthorized(ctx, ps, t, caducaEn);
    }

    // El dinero retenido se capturó de verdad (lo dispara `/confirm`).
    case "payment_intent.succeeded": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        paymentIntentId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (ps.status === "paid" || ps.status === "refunded") return "ya estaba pagada";

      await ps.update(
        { status: "paid", paidAt: new Date(), stripePaymentIntentId: obj.id },
        { transaction: t }
      );
      return await onEntityPaid(ctx, ps, t);
    }

    // La retención se soltó (rechazo, cancelación o caducidad). No hubo cobro.
    case "payment_intent.canceled": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        paymentIntentId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (ps.status === "paid" || ps.status === "refunded") {
        // Contradice a lo que tenemos guardado: no se toca nada por si acaso.
        process.stderr.write(
          `[stripe:webhook] ${ctx.slug}: payment_intent.canceled sobre un cobro que consta ${ps.status} (ps=${ps.id}) — revisar\n`
        );
        return `la sesión consta ${ps.status} — no se toca`;
      }
      if (ps.status === "void") return "ya estaba liberada";
      await ps.update({ status: "void" }, { transaction: t });
      return await onEntityAuthorizationVoided(ctx, ps, t);
    }

    // El banco dijo que no: ni al retener ni al capturar hubo dinero.
    case "payment_intent.payment_failed": {
      const ps = await buscarSesion(PaymentSession, {
        id: obj?.metadata?.paymentSessionId,
        paymentIntentId: obj?.id,
      }, t);
      if (!ps) return "sin PaymentSession";
      if (ps.status === "paid" || ps.status === "refunded") return "la sesión consta pagada — no se toca";
      // NO se marca la sesión como fallida definitivamente: mientras el
      // PaymentIntent siga vivo el paciente puede reintentar con otra tarjeta en
      // el mismo formulario. Cerrarlo aquí le dejaría sin poder terminar.
      const motivo = obj?.last_payment_error?.message ?? "sin detalle";
      process.stderr.write(`[stripe:webhook] ${ctx.slug} pago rechazado ps=${ps.id}: ${motivo}\n`);
      return `intento de pago rechazado (${motivo}) — el paciente puede reintentar`;
    }

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

      // ── El importe y la moneda tienen que cuadrar ─────────────────────────
      // La comprobación del importe era condicional (`Number.isInteger(...) &&`),
      // así que un evento SIN `amount_total` se la saltaba entera. Y la moneda no
      // se miraba: con conversión de divisa activada, 52 GBP pasaban por 52 €.
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      const importeOk = Number.isInteger(obj.amount_total) && obj.amount_total === ps.amount;
      const monedaOk =
        !obj.currency || String(obj.currency).toLowerCase() === String(ps.currency).toLowerCase();

      if (!importeOk || !monedaOk) {
        // El dinero YA está capturado en Stripe. Antes esto solo escribía una
        // línea de log y respondía 200: el evento quedaba marcado como procesado,
        // Stripe no reintentaba, y el paciente se quedaba sin cita Y sin dinero,
        // con el único rastro en una columna que ninguna pantalla lee.
        //
        // Ahora se guarda la referencia del cobro —sin ella la devolución es
        // imposible desde el CRM— y se devuelve automáticamente.
        await ps.update(
          {
            status: "failed",
            stripePaymentIntentId: pi ?? ps.stripePaymentIntentId,
            metadata: {
              ...(ps.metadata ?? {}),
              cobroInesperado: {
                recibido: obj.amount_total ?? null,
                monedaRecibida: obj.currency ?? null,
                esperado: ps.amount,
                monedaEsperada: ps.currency,
              },
            },
          },
          { transaction: t }
        );

        process.stderr.write(
          `[stripe:webhook] COBRO INESPERADO ${ctx.slug} ps=${ps.id}: esperado ${ps.amount} ${ps.currency}, recibido ${obj.amount_total} ${obj.currency}\n`
        );

        return {
          outcome: `importe/moneda no coinciden (recibido ${obj.amount_total} ${obj.currency}, esperado ${ps.amount} ${ps.currency})`,
          // Fuera de la transacción: llamar a Stripe dentro la alargaría y, si se
          // deshiciera, habríamos devuelto un dinero que en la BD sigue cobrado.
          postCommit: pi
            ? async () => {
                const stripe = await getStripe(ctx);
                // Sin `amount`: Stripe devuelve TODO lo que se cobró de verdad,
                // que es justo lo que hay que hacer (no sabemos por qué difiere).
                await stripe.refunds.create(
                  {
                    payment_intent: pi,
                    metadata: { paymentSessionId: ps.id, tenantSlug: ctx.slug, motivo: "importe inesperado" },
                  },
                  { idempotencyKey: `refund-mismatch:${ps.id}` }
                );
                await ps.update({
                  status: "refunded",
                  refundAmount: Number.isInteger(obj.amount_total) ? obj.amount_total : ps.amount,
                  refundedAt: new Date(),
                  refundReason: "importe inesperado — devuelto automáticamente",
                });
              }
            : null,
        };
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
      // Y se retira la cita: marcar solo la sesión dejaba una reserva 'pending'
      // eterna en la lista de espera de la profesional y en "Mi perfil" del
      // paciente, aunque el hueco ya se hubiera revendido.
      return await onEntityExpired(ctx, ps, t);
    }

    case "charge.refunded": {
      // Devolución hecha desde el panel de Stripe (fuera del CRM).
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;

      // Se busca por metadata primero y por payment_intent después. El
      // `payment_intent` SOLO lo escribe el handler de checkout.session.completed,
      // así que si ese evento aún no se ha procesado la columna está vacía y la
      // búsqueda no encuentra nada.
      let ps = null;
      if (obj?.metadata?.paymentSessionId) {
        ps = await PaymentSession.findByPk(obj.metadata.paymentSessionId, { transaction: t });
      }
      if (!ps && pi) {
        ps = await PaymentSession.findOne({ where: { stripePaymentIntentId: pi }, transaction: t });
      }

      if (!ps) {
        // ── NO se da por bueno ────────────────────────────────────────────
        // Antes se respondía "no aplica" y el evento quedaba marcado como
        // procesado PARA SIEMPRE. Escenario real: el `completed` del paciente
        // falla con 500 (contenedor reiniciándose durante un deploy) y entra en
        // la cola de reintentos; en esos minutos la profesional ve el cobro en
        // su panel y lo devuelve; llega el `charge.refunded`, no encuentra nada,
        // y la devolución no se registra nunca — la cita se queda como pagada.
        //
        // Lanzar deshace la transacción ENTERA (la marca del evento incluida),
        // así que Stripe reintenta y para entonces el `completed` ya habrá
        // pasado. Con un tope: si tras unas horas sigue sin aparecer, no es
        // nuestro (un cobro ajeno de la misma cuenta de Stripe) y seguir dando
        // 500 durante tres días solo llena el log.
        const horas = (Date.now() / 1000 - (event.created ?? 0)) / 3600;
        if (horas < 6) {
          throw new Error(
            `charge.refunded sin PaymentSession (pi=${pi}) — probablemente el cobro aún no se ha procesado; se reintentará`
          );
        }
        process.stderr.write(
          `[stripe:webhook] ${ctx.slug}: charge.refunded huérfano tras ${Math.round(horas)} h (pi=${pi}). Devolución NO registrada.\n`
        );
        return "devolución sin PaymentSession — revisar a mano";
      }

      if (ps.status === "refunded") return "no aplica";

      // Stripe emite `charge.refunded` también en devoluciones PARCIALES.
      // `amount_refunded` es el ACUMULADO del cargo, no lo de esta vez. Marcarlo
      // siempre como 'refunded' hacía dos daños: la cita figuraba devuelta entera
      // habiendo cobrado la diferencia, y `refundPayment` cortaba en seco al ver
      // el estado, dejando el resto del dinero imposible de devolver desde el CRM.
      const devuelto = Number.isInteger(obj.amount_refunded) ? obj.amount_refunded : ps.amount;
      const esTotal = devuelto >= ps.amount;

      await ps.update({
        status: esTotal ? "refunded" : "paid",
        refundAmount: devuelto,
        refundedAt: new Date(),
        refundReason: ps.refundReason ?? "devuelto desde Stripe",
      }, { transaction: t });

      // La cita solo deja de estar pagada si se devolvió TODO. Con un parcial
      // sigue habiendo dinero del paciente sobre la mesa.
      if (!esTotal) {
        return `reembolso parcial (${devuelto}/${ps.amount}) — la cita sigue pagada`;
      }
      return await onEntityRefunded(ctx, ps, t);
    }

    default:
      return `evento ignorado (${event.type})`;
  }
}

function buscarSesion(PaymentSession, { id, checkoutSessionId, paymentIntentId }, t) {
  if (id) return PaymentSession.findByPk(id, { transaction: t });
  if (checkoutSessionId) {
    return PaymentSession.findOne({ where: { stripeCheckoutSessionId: checkoutSessionId }, transaction: t });
  }
  // Por el PaymentIntent: es el ancla del flujo de retención, donde no hay
  // ninguna Checkout Session de por medio.
  if (paymentIntentId) {
    return PaymentSession.findOne({ where: { stripePaymentIntentId: paymentIntentId }, transaction: t });
  }
  return null;
}
