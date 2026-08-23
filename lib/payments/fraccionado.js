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
 * ¿Este calendario tiene ya puesto el tope, de verdad?
 *
 * Existir no basta: `subscriptionSchedules.create({ from_subscription })` nace
 * con `end_behavior: 'release'` —o sea, «cuando acabe, suéltala y que siga
 * cobrando»— y una sola fase. El tope es lo que hace el `update` de después.
 *
 * Con `restantes` cuotas por delante hace falta además la fase que las cubre;
 * si no queda ninguna (un plan de una sola cuota), basta con que cancele al
 * terminar la fase en curso.
 *
 * Se mira el NÚMERO de fases y no cuántos ciclos dura la segunda porque en la
 * respuesta de Stripe las fases vienen ya resueltas a `start_date`/`end_date`:
 * lo que se manda como `duration` no vuelve tal cual. Contar fases es lo único
 * que se puede comprobar sin rehacer la aritmética de los meses, y lo que de
 * verdad frena el cobro es el `end_behavior`.
 */
export function topePuesto(calendario, restantes) {
  if (calendario?.end_behavior !== "cancel") return false;
  if (restantes <= 0) return true;
  return (calendario?.phases ?? []).length >= 2;
}

/**
 * Cuánto tiene que durar la fase que cubre las cuotas que faltan.
 *
 * ⚠️ NO es `iterations` (arreglo 10/08/2026). Ese parámetro ya no existe: la
 * versión de la API que clavamos responde «Received unknown parameter:
 * phases[iterations]» y RECHAZA el update entero. Ese es el motivo real de que
 * las dos suscripciones de tunutrilaura se quedaran sin tope el 07/08/2026 —
 * no un fallo pasajero de red, como parecía: la llamada nunca pudo funcionar.
 *
 * Ahora la fase se mide con `duration: { interval, interval_count }`. Se toma
 * el intervalo del PRECIO de la suscripción en vez de dar por hecho «mes»:
 * `duration` cuenta intervalos de calendario y no ciclos de facturación, así
 * que con un precio bimensual dos cuotas son cuatro meses, no dos.
 */
function duracionDeFase(sub, ciclos) {
  const recurrencia = sub?.items?.data?.[0]?.price?.recurring;
  const interval = recurrencia?.interval ?? "month";
  const cada = Number(recurrencia?.interval_count) || 1;
  return { interval, interval_count: ciclos * cada };
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

  // La cuota que ya se cobró ocupa la fase 0 (el periodo de facturación en
  // curso). Las que faltan van en una segunda fase (ver `duracionDeFase`).
  const restantes = total - 1;

  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  /*
   * ⚠️ SI YA HAY CALENDARIO SE REUTILIZA, NO SE SALE (arreglo 10/08/2026).
   *
   * Antes esto era `if (sub.schedule) return <id>`, y esa salida convertía un
   * fallo de un momento en uno permanente: son DOS llamadas (crear + poner el
   * tope) y si la segunda no llega, queda un calendario en `release` sin tope.
   * El reintento del webhook veía que «ya hay calendario», se daba por hecho y
   * no volvía a intentarlo NUNCA. Pasó en las dos suscripciones de tunutrilaura
   * del 07/08/2026: las dos con `end_behavior: release` y sin la fase de
   * cuotas, o sea cobrando sin fin.
   *
   * La comprobación tiene que ser sobre el TOPE, que es lo que importa, no
   * sobre la existencia del calendario. Y sigue siendo idempotente: con el tope
   * ya puesto no se toca nada.
   */
  let calendario = null;
  if (sub.schedule) {
    const id = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    calendario = await stripe.subscriptionSchedules.retrieve(id);
    if (topePuesto(calendario, restantes)) return calendario.id;
  } else {
    calendario = await stripe.subscriptionSchedules.create(
      { from_subscription: subscriptionId },
      { idempotencyKey: `tope:${subscriptionId}` }
    );
  }

  const fase0 = calendario.phases?.[0];
  const items = itemsDeFase(fase0);
  if (!items.length) {
    throw new Error(`el calendario de ${subscriptionId} nació sin líneas — no se puede poner el tope`);
  }

  await stripe.subscriptionSchedules.update(calendario.id, {
    end_behavior: "cancel",
    phases: [
      // El update exige repetir la fase en curso TAL CUAL: lo que no se repite
      // se borra.
      { items, start_date: fase0.start_date, end_date: fase0.end_date },
      ...(restantes > 0 ? [{ items, duration: duracionDeFase(sub, restantes) }] : []),
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
  /*
   * ⚠️ EL LÍMITE TIENE QUE CUBRIR EL MÁXIMO DEL PRODUCTO (arreglo 21/08/2026).
   *
   * Antes se pedían 24 «porque un fraccionado real son 3-6», y esa cifra no era
   * la del producto: el tope del modelo son 36 cuotas
   * (`EventType.instalmentMonths`, `validate: { min: 2, max: 36 }`, y la API de
   * tipos de cita valida lo mismo), o sea que lo mete un admin desde la
   * pantalla, no un bot. Como la lista devolvía 24 como mucho y
   * `frenarSiYaEstaPagado` solo cancela con `pagadas >= total`, un plan de 25 o
   * más contestaba «cuota 24 de 25» en CADA webhook y no cancelaba nunca: el
   * segundo cerrojo dejaba de existir justo en los planes largos, que son los
   * que más dinero se llevan si el calendario no se llegó a poner.
   *
   * 100 es el máximo que Stripe sirve en una página, así que cabe cualquier plan
   * que el modelo permita dar de alta, con margen para uno al que ya se le
   * hubiera cobrado de más. No se pagina a propósito: mientras el tope del
   * modelo esté por debajo de 100, una página basta y el recuento es exacto.
   *
   * ⚠️ ESTE LÍMITE Y EL MÁXIMO DEL MODELO VAN ATADOS A MANO. La prueba fija el
   * `limit: 100` de aquí, así que se pone roja si alguien lo baja; pero NO lee
   * `EventType.instalmentMonths` (leer el modelo arrastraría Sequelize y la
   * convertiría en pesada), así que subir ese máximo por encima de 100 no
   * enciende ninguna luz: habría que paginar y nada lo cantaría. Quien toque el
   * `max: 36` del modelo tiene que volver aquí.
   */
  const facturas = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "paid",
    limit: 100,
  });
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
 *
 * ⚠️ `parent.subscription_details` es HOY el sitio bueno, y faltaba (10/08/2026).
 * Stripe movió ahí ese bloque en Basil y quitó la copia de la raíz de `Invoice`;
 * la versión que clavamos es muy posterior (ver `STRIPE_API_VERSION`), así que
 * el primer `??` no encuentra nada nunca y los otros dos tampoco pueden: la
 * metadata solo se escribe en `subscription_data` (checkout.js), ni en la
 * factura ni en sus líneas. Resultado: TODA cuota de la 2ª en adelante salía
 * como «factura sin PaymentSession» y el webhook la descartaba antes de contarla
 * y antes de llegar al cerrojo de `frenarSiYaEstaPagado`. Y en silencio: ese
 * camino devuelve un texto en vez de lanzar, así que Stripe daba el evento por
 * bueno y no reintentaba.
 *
 * Se ve mirando a `suscripcionDeFactura`, aquí debajo: esa sí contempla
 * `parent`. Se migró una de las dos y la otra se quedó atrás.
 *
 * La raíz se conserva por si Stripe sirve una factura vieja con la forma
 * antigua; no estorba y cuesta un `??`.
 */
export function sesionDeFactura(invoice) {
  return (
    invoice?.parent?.subscription_details?.metadata?.paymentSessionId ??
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
