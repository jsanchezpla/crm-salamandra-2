/**
 * Qué hacer cuando una entidad queda pagada o reembolsada.
 *
 * La capa de pagos no sabe nada de citas, pedidos ni facturas: cada módulo
 * registra aquí qué significa "esto ya está pagado" para él. Así el webhook de
 * Stripe es genérico y no acumula `if (entityType === ...)` por todo el fichero.
 *
 * ── SOBRE LA TRANSACCIÓN Y LOS EFECTOS EXTERNOS ────────────────────────────
 * Estas funciones se ejecutan DENTRO de la transacción del webhook, así que toda
 * escritura debe llevar `{ transaction: t }`. Lo que NO puede ir aquí es nada
 * irreversible hacia fuera (correos, avisos): si la transacción se deshace, el
 * correo ya se habría enviado y estaríamos diciéndole a alguien que su cita está
 * confirmada cuando en la base de datos no lo está.
 *
 * Por eso devuelven `{ outcome, postCommit }`: el webhook ejecuta `postCommit`
 * SOLO si la transacción se confirmó, y como best-effort.
 */

import { findBookingOverlap, lockBookingSlot } from "../citas/booking.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { esPack, crearPackDeCompra } from "../citas/packs.js";

/**
 * @param {object} ctx             tenantContext
 * @param {object} paymentSession  fila PaymentSession ya marcada como pagada
 * @param {object} [t]             transacción del webhook
 * @returns {Promise<{ outcome: string, postCommit?: () => Promise<void> }>}
 */
export async function onEntityPaid(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking":
      return await citaPagada(ctx, paymentSession, t);
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Ventana que se concede a un cobro de LIQUIDACIÓN DIFERIDA (SEPA, Multibanco,
 * Boleto…). Stripe da por terminado el checkout en cuanto el cliente acepta,
 * pero el dinero tarda días — o no llega nunca.
 *
 * Ojo: estos métodos encajan MAL con reservar citas, porque el dinero puede
 * confirmarse después de la propia cita. Ninguno viene activado por defecto;
 * activarlos es una decisión del profesional en su panel de Stripe.
 */
export const ASYNC_SETTLEMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * El cliente terminó el checkout pero AÚN NO HAY DINERO (liquidación diferida).
 * No se confirma nada; solo se mantiene el hueco reservado mientras se resuelve.
 */
export async function onEntityPaymentPending(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (cita.paymentStatus !== "pending") return { outcome: "la cita ya no espera pago" };

      // Se retiene el hueco mientras el dinero viaja, pero NUNCA más allá de la
      // hora de la propia cita: guardar un hueco ya pasado no sirve de nada y
      // dejaría la agenda bloqueada sin motivo.
      const tope = new Date(cita.scheduledAt);
      const propuesto = new Date(Date.now() + ASYNC_SETTLEMENT_WINDOW_MS);
      const nuevo = propuesto < tope ? propuesto : tope;

      if (cita.holdExpiresAt && new Date(cita.holdExpiresAt) >= nuevo) {
        return { outcome: "cobro diferido: el hueco ya estaba retenido lo suficiente" };
      }
      await cita.update({ holdExpiresAt: nuevo }, { transaction: t });
      return {
        outcome: `cita ${cita.id}: cobro diferido, hueco retenido hasta ${nuevo.toISOString()}`,
      };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Retira una cita que nunca llegó a cobrarse. Común al pago diferido que falla
 * y al checkout que caduca sin pagarse: en los dos casos no hay dinero y no debe
 * quedar rastro de la reserva en la agenda.
 */
async function retirarCitaImpagada(ctx, paymentSession, t, motivo) {
  const { Booking } = ctx.tenantModels;
  const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
  if (!cita) return { outcome: "cita no encontrada" };
  if (cita.status === "cancelled") return { outcome: "la cita ya estaba cancelada" };
  // Salvaguarda: si por lo que sea consta pagada, no se retira por un evento de
  // fallo o caducidad. Antes se mira a mano que no haya dinero de por medio.
  if (cita.paymentStatus === "paid") {
    return { outcome: `cita ${cita.id} consta PAGADA pese a "${motivo}" — revisar a mano` };
  }
  await cita.update(
    {
      status: "cancelled",
      paymentStatus: "failed",
      holdExpiresAt: null,
      cancelledAt: new Date(),
      cancellationReason: motivo,
    },
    { transaction: t }
  );
  return { outcome: `cita ${cita.id} retirada: ${motivo}` };
}

/**
 * El cobro diferido acabó FALLANDO. Se libera el hueco: nadie pagó.
 */
export async function onEntityPaymentFailed(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking":
      return await retirarCitaImpagada(ctx, paymentSession, t, "El pago no se completó");
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * La sesión de Stripe CADUCÓ sin pagarse: carrito abandonado.
 *
 * Antes esto solo marcaba la sesión de pago como caducada y no tocaba la cita,
 * que se quedaba en 'pending' PARA SIEMPRE. Consecuencias reales:
 *   · la profesional veía esas reservas fantasma en su lista de espera, sin
 *     forma de distinguirlas de las solicitudes de verdad, y podía confirmar a
 *     mano una cita que nadie había pagado;
 *   · el paciente las seguía viendo como cita próxima en "Mi perfil", aunque el
 *     hueco ya se hubiera vendido a otra persona.
 * La caducidad perezosa liberaba el HUECO, sí, pero no limpiaba la FILA.
 */
export async function onEntityExpired(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking":
      return await retirarCitaImpagada(ctx, paymentSession, t, "No se completó el pago a tiempo");
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * LA TARJETA HA QUEDADO RETENIDA. Es el momento en que la solicitud pasa a ser
 * real: hay dinero comprometido y entra en la lista de espera de la profesional.
 *
 * @param {Date|null} caducaEn  cuándo muere la retención (el `capture_before` de
 *   Stripe, leído con `leerCaducidadAutorizacion`). NUNCA calculado por nosotros.
 */
export async function onEntityAuthorized(ctx, paymentSession, t, caducaEn = null) {
  switch (paymentSession.entityType) {
    case "booking":
      return await citaConTarjetaRetenida(ctx, paymentSession, t, caducaEn);
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * La retención se soltó: ni la hubo, ni la habrá. Puede pasar por tres motivos —
 * la profesional rechazó la solicitud, alguien canceló la cita, o la retención
 * CADUCÓ sola pasados los días que da la red de la tarjeta.
 *
 * ── LO QUE ESTO NO HACE, Y ES DELIBERADO ─────────────────────────────────────
 * NO cancela la cita. Que el dinero se haya soltado no significa que la persona
 * deje de querer su hora: si fue una caducidad, hay un paciente real esperando y
 * la salida correcta es que la profesional lo vea marcado como "sin cobro" y
 * decida — confirmar sin cobrar, pedir otra tarjeta o rechazar. Cancelar aquí
 * por nuestra cuenta le quitaría esa decisión y borraría la solicitud de su
 * lista sin que se enterase.
 */
export async function onEntityAuthorizationVoided(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (["paid", "refunded"].includes(cita.paymentStatus)) {
        return { outcome: `la cita consta ${cita.paymentStatus} — no se toca` };
      }
      if (cita.paymentStatus === "void") return { outcome: "ya constaba sin retención" };
      await cita.update(
        { paymentStatus: "void", holdExpiresAt: null, authorizationExpiresAt: null },
        { transaction: t }
      );
      return { outcome: `cita ${cita.id}: retención liberada, sigue en pie sin cobro` };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/** Suelta una retención cuando ya no hay cita que dar. Corre fuera de la transacción. */
function soltarPorFaltaDeCita(ctx, paymentSession, motivo) {
  return async () => {
    try {
      const { liberarAutorizacion } = await import("./autorizacion.js");
      await liberarAutorizacion(ctx, paymentSession, { motivo, razonStripe: "abandoned" });
      process.stderr.write(
        `[pagos] retención liberada — tenant ${ctx.slug}, cobro ${paymentSession.id}: ${motivo}\n`
      );
    } catch (err) {
      // Queda dinero bloqueado en la tarjeta de alguien sin cita detrás. Caduca
      // solo en unos días, pero mientras tanto es dinero suyo inmovilizado.
      process.stderr.write(
        `[pagos] NO SE PUDO LIBERAR — tenant ${ctx.slug}, cobro ${paymentSession.id}: ${err.message}. Revisar a mano.\n`
      );
    }
  };
}

async function citaConTarjetaRetenida(ctx, paymentSession, t, caducaEn) {
  const { Booking, EventType } = ctx.tenantModels;

  const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
  if (!cita) {
    // No hay a quién dar la cita: el dinero no puede quedarse retenido.
    return {
      outcome: "cita no encontrada — se suelta la retención",
      postCommit: soltarPorFaltaDeCita(ctx, paymentSession, "la cita ya no existe"),
    };
  }

  // Idempotencia: Stripe reintenta durante 3 días.
  if (cita.paymentStatus === "authorized") {
    // Aprovecha para rellenar la caducidad si en el primer intento no vino.
    if (caducaEn && !cita.authorizationExpiresAt) {
      await cita.update({ authorizationExpiresAt: caducaEn }, { transaction: t });
      return { outcome: `cita ${cita.id}: ya estaba retenida, se anota la caducidad` };
    }
    return { outcome: "la cita ya constaba con la tarjeta retenida" };
  }
  if (["paid", "capturing", "refunded"].includes(cita.paymentStatus)) {
    return { outcome: `la cita ya iba por delante (${cita.paymentStatus})` };
  }

  // Si la cancelaron mientras metía la tarjeta, no hay cita que guardar.
  if (cita.status === "cancelled") {
    await cita.update({ paymentStatus: "void", holdExpiresAt: null }, { transaction: t });
    return {
      outcome: `cita ${cita.id} estaba cancelada — se suelta la retención`,
      postCommit: soltarPorFaltaDeCita(ctx, paymentSession, "la cita ya estaba cancelada"),
    };
  }

  // ── ¿El hueco sigue siendo suyo? ─────────────────────────────────────────
  // ESTA COMPROBACIÓN NO ES OPCIONAL. Entre que empezó a teclear la tarjeta y
  // ahora, su hold pudo caducar y otra persona quedarse la hora. Sin esto, dos
  // pacientes acaban con dinero retenido por la misma cita y la profesional ve
  // dos solicitudes idénticas sin saber cuál es buena.
  //
  // Va DENTRO de la transacción del webhook: fuera, la lectura no vería lo que
  // la propia transacción está escribiendo.
  //
  // Y CON EL CERROJO, con la misma clave que `/book` y `/confirm`. Comprobar el
  // solape sin él era exactamente la carrera que el cerrojo existe para cerrar:
  // este webhook puede llegar justo mientras otra persona reserva esa hora, y
  // los dos leerían "libre". Un chequeo de hueco sin serializar no comprueba
  // nada, solo lo parece.
  await lockBookingSlot(ctx.tenantSequelize, { transaction: t });

  const choque = await findBookingOverlap(Booking, {
    scheduledAt: cita.scheduledAt,
    duration: cita.duration,
    excludeId: cita.id,
    teamMemberId: cita.teamMemberId,
    transaction: t,
  });
  if (choque) {
    await cita.update(
      {
        status: "cancelled",
        paymentStatus: "void",
        holdExpiresAt: null,
        cancelledAt: new Date(),
        cancellationReason: "La hora se ocupó mientras completabas el pago",
      },
      { transaction: t }
    );
    process.stderr.write(
      `[pagos] RETENCIÓN SIN HUECO — tenant ${ctx.slug}, cita ${cita.id}: la hora ya la ocupa ${choque.id}. Se suelta.\n`
    );
    return {
      outcome: `cita ${cita.id}: el hueco ya lo ocupaba ${choque.id} — se suelta la retención`,
      postCommit: soltarPorFaltaDeCita(ctx, paymentSession, "el hueco ya estaba ocupado"),
    };
  }

  await cita.update(
    {
      paymentStatus: "authorized",
      // Deja de depender de la ventana corta: ahora hay dinero comprometido y la
      // hora es suya hasta que la profesional decida.
      holdExpiresAt: null,
      authorizationExpiresAt: caducaEn,
    },
    { transaction: t }
  );

  // El correo va fuera de la transacción (ver cabecera).
  const postCommit = async () => {
    const eventType = await EventType.findByPk(cita.eventTypeId);
    const { sendEmail } = await import("../email/resendClient.js");
    const { bookingReceivedTemplate } = await import("../email/templates/citas/bookingReceived.js");
    const tpl = bookingReceivedTemplate({
      tenantName: ctx.tenant.name,
      brand: ctx.tenant.settings?.brand,
      clientName: cita.clientName,
      eventTypeName: eventType?.name ?? "Cita",
      scheduledAt: cita.scheduledAt,
      // Lo que hace que el correo explique la retención en vez de callársela.
      retenido: cita.amount ?? null,
    });

    // Campana del CRM (05/08/2026). ESTE es el momento en que una cita con
    // tarjeta se convierte en solicitud de verdad: hay dinero retenido y entra
    // en la lista de espera. Antes de aquí solo había un formulario a medias,
    // así que avisar en `/book` llenaría la campana de gente que se echó atrás
    // al ver el importe.
    const { notifyAdmins } = await import("../notifications/notifyUsers.js");
    notifyAdmins({
      tenantId: ctx.tenant.id,
      tenantModels: ctx.tenantModels,
      type: "cita_solicitada",
      title: "Nueva solicitud de cita",
      body: `${cita.clientName} · ${eventType?.name ?? "Cita"} · ${new Date(cita.scheduledAt).toLocaleString("es-ES", {
        timeZone: "Europe/Madrid", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
      })}`,
      entityType: "Booking",
      entityId: cita.id,
      // Stripe reintenta los webhooks: sin esto, un reintento duplica el aviso.
      dedupe: true,
    }).catch(() => {});
    const cfgResend = getTenantResendConfig(ctx);
    await sendEmail({
      to: cita.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: cfgResend.fromEmail || undefined,
      replyTo: cfgResend.replyTo || undefined,
      apiKey: cfgResend.apiKey || undefined,
    });
  };

  return { outcome: `cita ${cita.id}: tarjeta retenida, a la lista de espera`, postCommit };
}

/**
 * Reembolso originado FUERA del CRM (p. ej. la profesional devuelve desde el
 * panel de Stripe). El CRM debe enterarse para no dejar la cita como pagada.
 */
export async function onEntityRefunded(ctx, paymentSession, t) {
  switch (paymentSession.entityType) {
    case "booking": {
      const { Booking } = ctx.tenantModels;
      const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
      if (!cita) return { outcome: "cita no encontrada" };
      if (cita.paymentStatus === "refunded") return { outcome: "ya estaba reembolsada" };
      // Solo se toca el dinero. Que la cita siga en pie o no es decisión de quien
      // la cancele: un reembolso desde Stripe no debería borrar la cita de la
      // agenda sin que nadie se entere.
      await cita.update({ paymentStatus: "refunded" }, { transaction: t });
      return { outcome: `cita ${cita.id} marcada como reembolsada` };
    }
    default:
      return { outcome: `sin acción para entityType=${paymentSession.entityType}` };
  }
}

/**
 * Devolución automática de un cobro que llegó cuando ya NO hay cita que dar.
 *
 * Pasa en dos casos, los dos reales: la profesional canceló mientras el paciente
 * tenía la pantalla de Stripe abierta, y el webhook llegó tan tarde que su hueco
 * ya se había revendido. Los dos dejaban solo un texto en la columna `outcome`
 * de `stripe_webhook_events`, que ninguna pantalla del CRM lee: dinero cobrado,
 * sin servicio, y sin que nadie se entere salvo que alguien haga un SELECT.
 *
 * ⚠️ HASTA EL 07/08/2026 ESTO DEVOLVÍA EL DINERO SOLO. Ya no: Rodrigo fijó que
 * el CRM no devuelve nunca y que las devoluciones las hace la consulta a mano.
 * Pero callarse tampoco vale — estos dos casos NO son «se cancela una sesión y
 * se le da otra fecha»: aquí no hay cita ninguna, la hora es de otra persona, y
 * quedarse el dinero sin decir nada es cobrar por algo que no existe.
 *
 * Así que ahora AVISA en la campana del CRM, con el importe y el motivo, para
 * que alguien decida: darle otra hora o devolvérselo desde Stripe. El aviso es
 * la parte importante de este fichero; sin él la regla «ya lo hacemos a mano»
 * se convierte en «no lo hace nadie».
 *
 * Corre como `postCommit`, fuera de la transacción del webhook, para no
 * alargarla.
 */
function avisarCobroSinCita(ctx, paymentSession, cita, motivo) {
  return async () => {
    try {
      const { notifyAdmins } = await import("../notifications/notifyUsers.js");
      const euros = Number.isInteger(cita.amount) ? (cita.amount / 100).toFixed(2) + " €" : "el importe";
      await notifyAdmins({
        tenantId: ctx.tenant.id,
        tenantModels: ctx.tenantModels,
        type: "cobro_sin_cita",
        title: "Cobro sin cita — revisar a mano",
        body: `${cita.clientName}: se le han cobrado ${euros} y ${motivo}. El CRM no devuelve dinero: decide tú si se le da otra hora o se le devuelve desde Stripe.`,
        entityType: "Booking",
        entityId: cita.id,
        // Stripe reintenta los webhooks: sin esto, un reintento duplica el aviso.
        dedupe: true,
      });
    } catch (err) {
      process.stderr.write(
        `[pagos] no se pudo avisar del cobro sin cita — tenant ${ctx.slug}, cita ${cita.id}: ${err.message}
`
      );
    }
    process.stderr.write(
      `[pagos] COBRO SIN CITA — tenant ${ctx.slug}, cita ${cita.id}, cobro ${paymentSession.id}: ${motivo}. NO se devuelve automáticamente; avisado en la campana.
`
    );
  };
}

/**
 * Cobro recibido de una cita.
 *
 * ── DOS FLUJOS MUY DISTINTOS DESEMBOCAN AQUÍ ─────────────────────────────────
 * 1. RETENCIÓN (el actual): la profesional YA confirmó la cita y por eso se
 *    capturó el dinero. Aquí no hay nada que decidir: solo anotar que el dinero
 *    entró. No se re-confirma (ya lo está), no se revalida el hueco (es suyo
 *    porque ella lo dio por bueno) y no se manda correo de confirmación (lo
 *    mandó `/confirm`).
 *
 * 2. COBRO INMEDIATO (`checkout.js`, hoy sin llamantes): pagar ERA lo que
 *    confirmaba la cita. Ahí sí hay que revalidar el hueco antes de confirmar,
 *    porque entre reservar y pagar la hora pudo venderse a otra persona.
 *
 * Se distinguen por el estado de la cita, que es el dato honesto: si ya está
 * 'confirmed', alguien decidió antes que el dinero. Mezclarlos era el fallo:
 * capturar tras confirmar disparaba la revalidación de hueco del flujo viejo y
 * podía devolver automáticamente un dinero que la profesional acababa de cobrar
 * a conciencia.
 */
async function citaPagada(ctx, paymentSession, t) {
  const { Booking, EventType } = ctx.tenantModels;

  const cita = await Booking.findByPk(paymentSession.entityId, { transaction: t });
  if (!cita) return { outcome: "cita no encontrada" };
  if (cita.paymentStatus === "paid") return { outcome: "la cita ya estaba pagada" };

  // Flujo de RETENCIÓN: la cita ya estaba confirmada antes del cobro.
  if (cita.status === "confirmed") {
    await cita.update(
      { paymentStatus: "paid", holdExpiresAt: null },
      { transaction: t }
    );
    return { outcome: `cita ${cita.id}: cobro registrado (ya estaba confirmada)` };
  }

  // Si la cita se canceló mientras el cliente pagaba (p. ej. la profesional la
  // rechazó), NO se confirma: se deja constancia del cobro para que el reembolso
  // sea posible, pero la agenda manda.
  const cancelada = cita.status === "cancelled";

  // ── ¿El hueco sigue siendo suyo? ─────────────────────────────────────────
  // Entre reservar y cobrar puede pasar de todo: que el hold caducara y otra
  // persona reservara y pagara esa misma hora, o que este webhook llegue con
  // horas de retraso tras los reintentos de Stripe. Confirmar sin mirar es
  // exactamente el caso de "dos pacientes cobrados por la misma hora".
  //
  // Se comprueba DENTRO de la transacción del webhook: fuera de ella la lectura
  // no vería lo que la propia transacción está escribiendo.
  if (!cancelada) {
    const choque = await findBookingOverlap(Booking, {
      scheduledAt: cita.scheduledAt,
      duration: cita.duration,
      excludeId: cita.id,
      teamMemberId: cita.teamMemberId,
      transaction: t,
    });
    if (choque) {
      // El dinero es real, así que `paid` es la verdad; lo que no hay es cita.
      // No se confirma, y se devuelve el importe al terminar la transacción.
      await cita.update({ paymentStatus: "paid", holdExpiresAt: null }, { transaction: t });
      const motivo = "el hueco ya estaba ocupado cuando llegó el pago";
      process.stderr.write(
        `[pagos] COBRO SIN HUECO — tenant ${ctx.slug}, cita ${cita.id}: pagada, pero la hora ya la ocupa la cita ${choque.id}. Se devuelve.\n`
      );
      return {
        outcome: `cita ${cita.id} pagada pero el hueco ya estaba ocupado por ${choque.id} — avisado, NO se devuelve`,
        postCommit: avisarCobroSinCita(ctx, paymentSession, cita, motivo),
      };
    }
  }

  await cita.update(
    {
      paymentStatus: "paid",
      // Pagar CONFIRMA la cita: es la decisión de negocio de este sprint.
      status: cancelada ? cita.status : "confirmed",
      // Deja de ser provisional: ya no depende de una caducidad.
      holdExpiresAt: null,
    },
    { transaction: t }
  );

  if (cancelada) {
    const motivo = "la cita ya estaba cancelada cuando llegó el pago";
    process.stderr.write(
      `[pagos] COBRO DE CITA CANCELADA — tenant ${ctx.slug}, cita ${cita.id}. Se devuelve.\n`
    );
    return {
      outcome: `cita ${cita.id} pagada pero estaba CANCELADA — avisado, NO se devuelve`,
      postCommit: avisarCobroSinCita(ctx, paymentSession, cita, motivo),
    };
  }

  // ── ¿Esta compra era un BONO? ────────────────────────────────────────────
  // Si el tipo de cita vale por varias sesiones, el bono nace AQUÍ: cuando el
  // dinero está confirmado, no al reservar. Quien abre el formulario de pago y
  // se echa atrás no puede quedarse con diez sesiones. Esta cita pasa a ser la
  // sesión 1 de su propio bono; las siguientes se enganchan solas al reservar.
  //
  // Va DENTRO de la transacción del webhook, junto al `paid` de la cita: o
  // constan las dos cosas o no consta ninguna. Y es idempotente por sesión de
  // pago, porque Stripe reintenta los webhooks.
  const tipoDeLaCita = await EventType.findByPk(cita.eventTypeId, { transaction: t });
  if (esPack(tipoDeLaCita)) {
    try {
      await crearPackDeCompra(
        ctx.tenantModels,
        { booking: cita, eventType: tipoDeLaCita, paymentSession },
        t
      );
    } catch (err) {
      // El dinero YA está cobrado y la cita ya consta pagada. Reventar aquí
      // desharía la transacción entera del webhook y dejaría a alguien cobrado
      // y sin cita, que es mucho peor que un bono sin crear. Se deja el aviso
      // bien visible: hay que crearlo a mano y averiguar por qué falló.
      process.stderr.write(
        `[pagos] BONO NO CREADO — tenant ${ctx.slug}, cita ${cita.id}: ${err.message}. La cita SÍ está pagada y confirmada; hay que crear el bono a mano.\n`
      );
    }
  }

  // El correo va fuera de la transacción (ver cabecera).
  const postCommit = async () => {
    const eventType = await EventType.findByPk(cita.eventTypeId);
    const { sendEmail } = await import("../email/resendClient.js");
    const { bookingConfirmedTemplate } = await import("../email/templates/citas/bookingConfirmed.js");
    const tpl = bookingConfirmedTemplate({
      tenantName: ctx.tenant.name,
      brand: ctx.tenant.settings?.brand,
      clientName: cita.clientName,
      eventTypeName: eventType?.name ?? "Cita",
      scheduledAt: cita.scheduledAt,
      duration: cita.duration,
      modality: cita.modality,
      meetUrl: cita.meetUrl,
      cancelUrl: cita.cancellationToken
        ? `/widget/c/${ctx.slug}/cancel/${cita.cancellationToken}`
        : null,
      location: eventType?.location ?? null,
    });
    // BYOK: la confirmación tras el pago sale de la cuenta del negocio.
    const cfgResend = getTenantResendConfig(ctx);
    await sendEmail({
      to: cita.clientEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: cfgResend.fromEmail || undefined,
      replyTo: cfgResend.replyTo || undefined,
      apiKey: cfgResend.apiKey || undefined,
    });
  };

  return { outcome: `cita ${cita.id} confirmada tras el pago`, postCommit };
}
