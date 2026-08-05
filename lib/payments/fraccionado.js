/**
 * lib/payments/fraccionado.js — el pago a plazos, cobrado por Stripe
 * (05/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten DOS ramas del webhook que no
 * se hablan entre ellas —la del primer pago y la de las cuotas siguientes— y es
 * el único sitio que entiende la forma de un subscription schedule de Stripe.
 * `checkout.js` crea la sesión y no debe saber de topes; `packs.js` sabe de
 * bonos y no debe saber de Stripe.)
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
 * Antes, «pagar a plazos» era Klarna: adelantaba el dinero, financiaba a la
 * paciente y se llevaba su comisión. Laura quería quitarse ese intermediario y
 * cobrar ella la tarjeta mes a mes. Eso es exactamente una suscripción de
 * Stripe con un número fijo de cuotas.
 *
 * ── POR QUÉ EL TOPE SE PONE AQUÍ Y NO AL CREAR LA SESIÓN ────────────────────
 * Checkout no sabe de topes: crea una suscripción que renovaría para siempre.
 * El tope se pone en cuanto el primer pago se confirma, colgándole un
 * subscription schedule con `end_behavior: 'cancel'`.
 *
 * Y no se crea el calendario directamente (que sería más limpio) porque la
 * primera factura de un schedule NO se finaliza al momento: nace en borrador y
 * Stripe la cierra alrededor de una hora después. La paciente terminaría de
 * reservar sin que nadie sepa en una hora si ha pagado, con el hueco ya
 * soltado. Con Checkout, el primer cobro y su autenticación pasan ahí mismo.
 *
 * ── DOS CERROJOS, A PROPÓSITO ───────────────────────────────────────────────
 * Cobrar de más es el fallo catastrófico de este fichero: es el dinero de una
 * paciente. Por eso hay dos frenos independientes:
 *
 *   1. El SCHEDULE, que vive en Stripe. Aunque nuestro servidor esté caído un
 *      mes entero, Stripe deja de cobrar en la cuota N. Es el freno bueno.
 *   2. El RECUENTO, en `frenarSiYaEstaPagado`. Si el schedule no se llegó a
 *      crear (la llamada falló, un despliegue a medias), cada cuota que entra
 *      cuenta las facturas pagadas y cancela la suscripción al llegar a N.
 *
 * El segundo existe porque el primero se pone en una llamada de red que puede
 * fallar. Sin él, un fallo de 200 ms dejaría a alguien pagando 130 € al mes
 * indefinidamente.
 */

import { getStripe } from "./stripeConfig.js";

/** Los ids de precio de una fase, en la forma que acepta el update. */
function itemsDeFase(fase) {
  return (fase?.items ?? []).map((item) => ({
    price: typeof item.price === "string" ? item.price : item.price?.id,
    quantity: item.quantity ?? 1,
  }));
}

/**
 * Le pone tope de `cuotas` cargos a una suscripción recién creada.
 *
 * `cuotas` son los meses TOTALES del acuerdo, la primera cuota incluida. Como
 * esa ya se cobró en el checkout, el calendario solo programa las que faltan.
 *
 * Idempotente: si la suscripción ya tiene calendario, no hace nada. Stripe
 * reintenta los webhooks y un segundo calendario sobre la misma suscripción
 * sería un error de la API, no un duplicado inofensivo.
 *
 * Devuelve el id del calendario, o null si no había nada que hacer.
 */
export async function ponerTopeDeCuotas(ctx, { subscriptionId, cuotas }) {
  const total = Number(cuotas);
  if (!subscriptionId || !Number.isInteger(total) || total < 1) return null;

  const stripe = await getStripe(ctx);

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (sub.schedule) return typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;

  const calendario = await stripe.subscriptionSchedules.create(
    { from_subscription: subscriptionId },
    { idempotencyKey: `tope:${subscriptionId}` }
  );

  const fase0 = calendario.phases?.[0];
  const items = itemsDeFase(fase0);
  if (!items.length) {
    throw new Error(`el calendario de ${subscriptionId} nació sin líneas — no se puede poner el tope`);
  }

  // La cuota que ya se cobró ocupa la fase 0 (el periodo de facturación en
  // curso). Las que faltan van en una segunda fase con `iterations`.
  const restantes = total - 1;

  await stripe.subscriptionSchedules.update(calendario.id, {
    end_behavior: "cancel",
    phases: [
      // El update exige repetir la fase en curso TAL CUAL: lo que no se repite
      // se borra.
      { items, start_date: fase0.start_date, end_date: fase0.end_date },
      ...(restantes > 0 ? [{ items, iterations: restantes }] : []),
    ],
  });

  return calendario.id;
}

/**
 * Cuántas facturas se han cobrado ya de esta suscripción.
 *
 * Se cuentan las `paid` de verdad, no las emitidas: una factura abierta que el
 * banco rechazó no es una cuota pagada, y contarla dejaría a la paciente con
 * una sesión menos de las que ha pagado.
 */
export async function cuotasPagadasDe(ctx, subscriptionId) {
  const stripe = await getStripe(ctx);
  let pagadas = 0;
  // 24 cubre de sobra el máximo del producto (36 meses es el tope del modelo,
  // pero un fraccionado real son 3-6); si algún día hiciera falta más, esto se
  // queda corto por abajo y el cerrojo bueno sigue siendo el schedule.
  const facturas = await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 24 });
  for (const f of facturas.data ?? []) {
    if (f.status === "paid") pagadas += 1;
  }
  return pagadas;
}

/**
 * Cerrojo de seguridad: si ya se han cobrado todas las cuotas, cancela.
 *
 * Es la red por si el calendario no se llegó a poner. En condiciones normales
 * no hace nada, porque para cuando llega la última cuota Stripe ya ha cancelado
 * la suscripción él solo.
 *
 * Devuelve un texto para el registro del webhook.
 */
export async function frenarSiYaEstaPagado(ctx, { subscriptionId, cuotas }) {
  const total = Number(cuotas);
  if (!subscriptionId || !Number.isInteger(total) || total < 1) return "sin datos del plan";

  const pagadas = await cuotasPagadasDe(ctx, subscriptionId);
  if (pagadas < total) return `cuota ${pagadas} de ${total}`;

  const stripe = await getStripe(ctx);
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (sub.status === "canceled") return `plan completo (${pagadas}/${total}), ya estaba cancelado`;

  // Si tiene calendario hay que cancelarlo a él: cancelar la suscripción por
  // debajo deja el calendario vivo y Stripe lo vuelve a montar.
  if (sub.schedule) {
    const id = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    await stripe.subscriptionSchedules.cancel(id);
  } else {
    await stripe.subscriptions.cancel(subscriptionId);
  }

  process.stderr.write(
    `[pagos:fraccionado] ${ctx.slug}: plan completo (${pagadas}/${total}) — suscripción ${subscriptionId} cancelada por el cerrojo de seguridad; revisar por qué no lo hizo el calendario\n`
  );
  return `plan completo (${pagadas}/${total}) — cancelado`;
}

/**
 * El id de nuestra PaymentSession a partir de una factura de Stripe.
 *
 * Viaja en la metadata de la SUSCRIPCIÓN (se pone al crear el checkout) y
 * Stripe la copia a cada factura. Se miran varios sitios porque el nombre del
 * campo ha cambiado entre versiones de la API y una factura sin identificar es
 * una cuota que no se apunta en ninguna parte.
 */
export function sesionDeFactura(invoice) {
  return (
    invoice?.subscription_details?.metadata?.paymentSessionId ??
    invoice?.lines?.data?.[0]?.metadata?.paymentSessionId ??
    invoice?.metadata?.paymentSessionId ??
    null
  );
}

/** El id de la suscripción de una factura, venga expandida o como texto. */
export function suscripcionDeFactura(invoice) {
  const s = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription ?? null;
  return typeof s === "string" ? s : (s?.id ?? null);
}
