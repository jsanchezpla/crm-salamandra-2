/**
 * lib/payments/cuotaRechazada.js — qué pasa cuando el banco rechaza una cuota
 * del pago fraccionado, y cuando Stripe da el plan por perdido (07/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el webhook de Stripe —que es
 * quien se entera—, la ficha del paciente y el portal —que son quienes lo
 * enseñan— y la prueba `_smoke-cuota-rechazada.mjs`. Nada de esto sabe de
 * bonos ni de citas: solo de cuotas y de cómo contarlo.)
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 * El 07/09/2026 el banco de una paciente de tunutrilaura rechazó la 2.ª cuota
 * de su plan (`card_velocity_exceeded`: la tarjeta había superado el límite de
 * gasto que le pone su banco). Stripe hizo lo suyo —un intento, y programar el
 * siguiente para dos días después—, pero el CRM se enteró y no supo decirlo:
 *   · apuntó «rechazada por el banco» a secas, porque leía el motivo de
 *     `last_finalization_error`, que es el error de EMITIR la factura, no el
 *     de COBRARLA. El de cobrar vive en el PaymentIntent del intento, y desde
 *     Basil la factura ya no lo lleva encima: cuelga de `invoice_payments`;
 *   · no avisó a nadie: quedó una línea en el log del contenedor y una clave
 *     en un JSONB que ninguna pantalla leía. Laura se enteró mirando Stripe;
 *   · y si la cuota entraba al reintento, el rastro del rechazo se quedaba
 *     puesto para siempre.
 *
 * ── LO QUE NO HACE, A PROPÓSITO ─────────────────────────────────────────────
 * No reintenta el cobro (Stripe lo hace mejor, con sus Smart Retries y sin
 * cargar dos veces), no toca el bono (una tarjeta con el límite superado no es
 * un impago) y no escribe a la paciente por su cuenta: Stripe ya le manda el
 * correo del pago fallido con el enlace para pagar con otra tarjeta si el
 * centro lo tiene activado. Lo que sí hace: guardar el motivo REAL en palabras
 * que entienda una nutricionista, avisar en la campana, enseñarlo en la ficha y
 * en «Mis pagos», y limpiar el rastro cuando la cuota por fin entra.
 */

/**
 * Los códigos de rechazo de Stripe que más se ven, explicados para quien lleva
 * el centro. Lo que no esté aquí sale con el mensaje que mande Stripe.
 *
 * `decline_code` es lo que dice el BANCO; `code` lo que dice Stripe. Se mira
 * primero el del banco porque es el que explica qué tiene que hacer la paciente.
 */
export const EXPLICACION_RECHAZO = {
  card_velocity_exceeded:
    "la tarjeta ha superado el límite de gasto que le pone su banco (por importe o por número de operaciones en un periodo); suele arreglarse subiendo el límite en la app del banco o pagando con otra tarjeta",
  withdrawal_count_limit_exceeded: "la tarjeta ha superado el número de operaciones que le permite su banco",
  insufficient_funds: "no había saldo suficiente en la tarjeta",
  expired_card: "la tarjeta está caducada",
  lost_card: "la tarjeta figura como perdida en su banco",
  stolen_card: "la tarjeta figura como robada en su banco",
  pickup_card: "el banco ha bloqueado la tarjeta",
  restricted_card: "el banco tiene la tarjeta restringida",
  do_not_honor: "el banco no ha autorizado el cargo y no da más detalle",
  generic_decline: "el banco ha rechazado el cargo sin dar motivo",
  fraudulent: "el banco sospecha que el cargo es fraudulento",
  transaction_not_allowed: "la tarjeta no permite este tipo de cargo",
  card_not_supported: "la tarjeta no admite este tipo de compra",
  currency_not_supported: "la tarjeta no admite cargos en euros",
  authentication_required:
    "el banco exige autenticación (3D Secure) y un cobro automático no puede pedírsela: la paciente tiene que pagar esta cuota a mano",
  invalid_account: "la cuenta asociada a la tarjeta ya no es válida",
  new_account_information_available: "la tarjeta se ha renovado y los datos guardados ya no sirven",
  revocation_of_all_authorizations: "la titular ha revocado en su banco todos los cobros automáticos",
  revocation_of_authorization: "la titular ha revocado en su banco este cobro automático",
  stop_payment_order: "la titular ha pedido a su banco que pare este cobro",
  processing_error: "hubo un error al procesar el cargo (no es de la tarjeta)",
  try_again_later: "el banco ha pedido que se intente más tarde",
  incorrect_cvc: "el código de seguridad de la tarjeta no es correcto",
  incorrect_number: "el número de tarjeta no es correcto",
  card_declined: "el banco ha rechazado la tarjeta",
};

const EXPLICACION_POR_DEFECTO = "el banco ha rechazado el cargo";

/**
 * De un error de pago de Stripe (`last_payment_error`, o el `outcome` de un
 * cargo) a un código y una frase en castellano.
 *
 * @returns {{ codigo: string|null, explicacion: string }}
 */
export function explicarRechazo(error) {
  const codigo = error?.decline_code || error?.code || null;
  const conocida = codigo ? EXPLICACION_RECHAZO[codigo] : null;
  if (conocida) return { codigo, explicacion: conocida };
  const mensaje = typeof error?.message === "string" ? error.message.trim() : "";
  return { codigo, explicacion: mensaje || EXPLICACION_POR_DEFECTO };
}

/** Las claves del rastro de un rechazo en `PaymentSession.metadata`. */
export const CLAVES_RASTRO_RECHAZO = [
  "cuotaFallidaAt",
  "cuotaFallidaFactura",
  "cuotaFallidaIntentos",
  "cuotaFallidaImporte",
  "cuotaFallidaMotivo",
  "cuotaFallidaCodigo",
  "proximoIntentoAt",
  "enlacePagoCuota",
];

const iso = (segundos) => (segundos ? new Date(Number(segundos) * 1000).toISOString() : null);

/**
 * Lo que se apunta en la fila de cobro con SOLO la factura del evento, sin
 * preguntar nada a Stripe (va dentro de la transacción del webhook, y ahí no
 * se sale a la red). El motivo queda provisional: lo afina
 * `motivoDeRechazoDeFactura` en el postCommit.
 *
 * `next_payment_attempt` es la promesa de Stripe de volver a intentarlo
 * (Smart Retries). Si viene vacío, Stripe se ha rendido: hay que hablar con la
 * paciente. `hosted_invoice_url` es la página donde puede pagar esa cuota con
 * otra tarjeta; se guarda para enseñársela en su portal.
 */
export function rastroDeRechazo(invoice, ahora = new Date()) {
  return {
    cuotaFallidaAt: ahora.toISOString(),
    cuotaFallidaFactura: invoice?.id ?? null,
    cuotaFallidaIntentos: Number(invoice?.attempt_count) > 0 ? Number(invoice.attempt_count) : 1,
    cuotaFallidaImporte: Number.isInteger(invoice?.amount_due) ? invoice.amount_due : null,
    cuotaFallidaMotivo: EXPLICACION_POR_DEFECTO,
    cuotaFallidaCodigo: null,
    proximoIntentoAt: iso(invoice?.next_payment_attempt),
    enlacePagoCuota: typeof invoice?.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null,
  };
}

/** La metadata sin el rastro del rechazo: para cuando la cuota por fin entra. */
export function sinRastroDeRechazo(metadata) {
  const limpia = { ...(metadata ?? {}) };
  for (const clave of CLAVES_RASTRO_RECHAZO) delete limpia[clave];
  return limpia;
}

/**
 * El motivo REAL de un rechazo, preguntándoselo a Stripe.
 *
 * Desde Basil la factura no lleva `payment_intent`: cada intento de cobro es
 * un `invoice_payment` que apunta a su PaymentIntent, y es ESE el que guarda
 * `last_payment_error` con el `decline_code` del banco. Se mira el intento más
 * reciente, que es el que explica el rechazo de hoy.
 *
 * Devuelve `null` si no hay ningún intento con error (o si Stripe no contesta
 * lo esperado): el rastro se queda con el motivo provisional, no se inventa.
 */
export async function motivoDeRechazoDeFactura(stripe, invoiceId) {
  if (!stripe?.invoicePayments?.list || !invoiceId) return null;
  const pagos = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  const intentos = (pagos?.data ?? [])
    .filter((p) => p?.payment?.type === "payment_intent" && p.payment.payment_intent)
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
  for (const intento of intentos) {
    const id =
      typeof intento.payment.payment_intent === "string"
        ? intento.payment.payment_intent
        : intento.payment.payment_intent?.id;
    if (!id) continue;
    const pi = await stripe.paymentIntents.retrieve(id);
    if (pi?.last_payment_error) return explicarRechazo(pi.last_payment_error);
  }
  return null;
}

/**
 * El estado del plan de cuotas tal como lo enseñan la ficha y el portal, a
 * partir de `PaymentSession.metadata`. `null` si la compra no era a plazos.
 */
export function estadoCuotasDe(metadata) {
  const m = metadata ?? {};
  const total = Number(m.instalmentMonths);
  if (!Number.isInteger(total) || total < 1) return null;
  const pagadas = Math.min(total, Number(m.cuotasPagadas) > 0 ? Number(m.cuotasPagadas) : 1);

  const rechazada = m.cuotaFallidaAt
    ? {
        cuota: Math.min(total, pagadas + 1),
        fecha: m.cuotaFallidaAt,
        motivo: m.cuotaFallidaMotivo || EXPLICACION_POR_DEFECTO,
        codigo: m.cuotaFallidaCodigo ?? null,
        intentos: Number(m.cuotaFallidaIntentos) > 0 ? Number(m.cuotaFallidaIntentos) : 1,
        importe: Number.isInteger(m.cuotaFallidaImporte) ? m.cuotaFallidaImporte : null,
        proximoIntento: m.proximoIntentoAt ?? null,
        enlacePago: m.enlacePagoCuota ?? null,
      }
    : null;

  const interrumpido = m.planInterrumpidoAt ? { fecha: m.planInterrumpidoAt } : null;

  return {
    total,
    pagadas,
    completo: pagadas >= total,
    rechazada,
    interrumpido,
    resumen: `${pagadas} de ${total} cuota${total === 1 ? "" : "s"} cobrada${total === 1 ? "" : "s"}`,
  };
}

/** «9 sept, 17:03», hora de Madrid, para las campanas y las pantallas. */
export function fechaCorta(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const euros = (centimos) =>
  Number.isInteger(centimos) ? (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : null;

/**
 * El texto de la campana cuando una cuota rebota. Dice qué ha pasado, por qué,
 * qué va a hacer Stripe y qué NO ha pasado (el bono sigue activo), que es lo
 * que Laura preguntó el 07/09/2026.
 */
export function avisoDeCuotaRechazada({ nombre, programa, estado }) {
  const r = estado?.rechazada;
  const quien = [nombre, programa].filter(Boolean).join(" · ") || "Una paciente";
  const importe = euros(r?.importe);
  const cual = r ? `la cuota ${r.cuota} de ${estado.total}${importe ? ` (${importe})` : ""}` : "una cuota";
  const motivo = r?.motivo || EXPLICACION_POR_DEFECTO;
  const despues = r?.proximoIntento
    ? `Stripe lo volverá a intentar el ${fechaCorta(r.proximoIntento)}; si entra, este aviso queda sin efecto.`
    : "Stripe no va a reintentarlo: hay que hablar con la paciente para cobrar esta cuota.";
  return {
    title: "Cuota del pago a plazos rechazada por el banco",
    body: `${quien}: ${cual} no se ha podido cobrar porque ${motivo}. ${despues} El bono sigue activo: el CRM no le quita sesiones por un rechazo del banco.`,
  };
}

/**
 * El texto de la campana cuando Stripe da la suscripción por perdida con
 * cuotas sin cobrar. Aquí sí hay una decisión que tomar, y es de la profesional.
 */
export function avisoDePlanInterrumpido({ nombre, programa, estado }) {
  const quien = [nombre, programa].filter(Boolean).join(" · ") || "Una paciente";
  const pagadas = estado?.pagadas ?? "?";
  const total = estado?.total ?? "?";
  return {
    title: "Plan a plazos cancelado sin completar",
    body: `${quien}: Stripe ha cancelado la suscripción con ${pagadas} de ${total} cuotas cobradas y ya no va a intentar cobrar las que faltan. El bono sigue entero: decide si se lo quitas desde su ficha («Quitar bono») o si le cobras el resto por otra vía.`,
  };
}

/**
 * Quién es la paciente y qué compró, para las campanas. Best-effort: sin cita
 * detrás (o sin módulo de citas) se avisa igual, solo que sin nombre.
 */
export async function quienYQue(ctx, paymentSession) {
  const { Booking, EventType } = ctx.tenantModels ?? {};
  let nombre = null;
  let programa = null;
  try {
    if (paymentSession?.entityType === "booking" && Booking) {
      const cita = await Booking.findByPk(paymentSession.entityId);
      nombre = cita?.clientName || cita?.clientEmail || null;
      if (cita?.eventTypeId && EventType) {
        const tipo = await EventType.findByPk(cita.eventTypeId, { attributes: ["name"] });
        programa = tipo?.name ?? null;
      }
    }
  } catch {
    /* sin nombre se avisa igual */
  }
  return { nombre, programa };
}

/**
 * La campana a los admins del centro, con el mismo `dedupe` que el resto de
 * avisos que nacen de un webhook (Stripe reintenta; un reintento no debe
 * duplicar el aviso). `reemplazar` quita el aviso anterior del mismo hecho: un
 * segundo rechazo de la misma cuota es un aviso NUEVO, no uno repetido.
 */
export async function avisarAlCentro(ctx, paymentSession, { type, title, body }) {
  const { notifyAdmins } = await import("../notifications/notifyUsers.js");
  await notifyAdmins({
    tenantId: ctx.tenant.id,
    tenantModels: ctx.tenantModels,
    type,
    title,
    body,
    entityType: "PaymentSession",
    entityId: paymentSession.id,
    reemplazar: true,
  });
}
