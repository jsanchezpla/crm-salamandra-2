/**
 * lib/citas/caducidadRetencion.js — vigila el dinero retenido que se va a morir.
 *
 * (Fichero nuevo en /lib, regla #2: lo usa el ejecutor programado
 * scripts/vigilar-retenciones.js, igual que `recordatorios.js` es usado por
 * scripts/enviar-recordatorios.js.)
 *
 * ── POR QUÉ HACE FALTA VIGILAR ───────────────────────────────────────────────
 * Una retención de tarjeta caduca sola a los ~7 días y, al caducar, el
 * PaymentIntent queda MUERTO: no se puede capturar, hay que pedir la tarjeta de
 * cero. Y lo peor: **Stripe no garantiza avisar de eso**. Las Checkout Sessions
 * tienen su evento de caducidad; un PaymentIntent no tiene equivalente fiable.
 *
 * Así que si nadie mira, pasan dos cosas malas a la vez:
 *   · nadie avisa a la profesional de que le quedan horas para cobrar, y
 *   · cuando ya ha caducado, el CRM le sigue enseñando "Retenido, sin cobrar"
 *     sobre un dinero que ya no existe. Pulsaría "Confirmar y cobrar" y se
 *     encontraría un error donde esperaba un ingreso.
 *
 * Por eso este módulo hace DOS cosas, y la segunda es la que de verdad importa:
 *
 *   1. AVISAR de las retenciones que están a punto de morir (campana a los
 *      admins). Dos niveles: con tiempo, y urgente.
 *   2. RECONCILIAR las que ya murieron: preguntarle a Stripe por el estado real
 *      y, si el dinero ya no está, dejarlo escrito. Es la diferencia entre una
 *      pantalla que miente y una que no.
 *
 * La cita NUNCA se cancela por esto. Que el dinero se haya evaporado no
 * significa que la persona deje de querer su hora: sigue en la lista de espera,
 * marcada sin cobro, para que la profesional decida (confirmar sin cobrar,
 * pedirle otra tarjeta o rechazar).
 *
 * Best-effort en todo: que Stripe no conteste no puede tumbar la pasada.
 */

import { Op } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";
import { getStripe, tenantHasStripe } from "../payments/stripeConfig.js";

const HORA = 60 * 60 * 1000;

/**
 * Umbrales de aviso. El primero da margen para actuar con calma; el segundo es
 * la última llamada.
 *
 * No se avisa antes: una retención de 7 días avisada el primer día es ruido, y
 * el ruido acaba en que no se miran los avisos.
 */
export const AVISOS = [
  { tipo: "hold_caduca_pronto", horas: 36, etiqueta: "mañana" },
  { tipo: "hold_caduca_ya", horas: 6, etiqueta: "en unas horas" },
];

/** La ventana más ancha: lo que hay que mirar en la consulta. */
const VENTANA_MAX_H = Math.max(...AVISOS.map((a) => a.horas));

/**
 * De todos los umbrales que encajan, el MÁS AJUSTADO.
 *
 * No es un detalle: con un `find` sobre la lista tal cual, a una retención a la
 * que le quedaran 3 horas se le aplicaba el umbral de 36 —porque también lo
 * cumple— y salía el aviso tranquilo. Y como los avisos van deduplicados por
 * tipo, la última llamada NO se mandaba nunca: el nivel urgente estaba muerto.
 * Elegir por el umbral menor hace además que el orden del array dé igual.
 */
function avisoQueToca(quedanHoras) {
  return AVISOS.filter((a) => quedanHoras <= a.horas).sort((a, b) => a.horas - b.horas)[0] ?? null;
}

/** Estados en los que hay dinero retenido pendiente de capturar. */
const CON_RETENCION = ["authorized", "capturing"];

function cuando(fecha) {
  return new Date(fecha).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function euros(centimos) {
  if (!Number.isInteger(centimos)) return "";
  return (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

/**
 * Manda una notificación a los admins del tenant, UNA sola vez por cita y tipo.
 *
 * La deduplicación va contra la propia tabla de notificaciones y no contra una
 * columna nueva en `bookings`: así no hace falta migrar nada y el aviso vive
 * donde la profesional ya mira. Si el ejecutor corre cada hora, esto evita que
 * reciba el mismo aviso 36 veces.
 */
async function avisarUnaVez({ tenant, Notification, booking, tipo, titulo, cuerpo }) {
  const yaAvisado = await Notification.findOne({
    where: { type: tipo, entityType: "Booking", entityId: booking.id },
    attributes: ["id"],
  });
  if (yaAvisado) return false;

  const { User } = getMasterModels();
  const admins = await User.findAll({
    where: { tenantId: tenant.id, role: "admin" },
    attributes: ["id"],
  });
  if (!admins.length) return false;

  for (const admin of admins) {
    await Notification.create({
      userId: admin.id,
      channel: "app",
      type: tipo,
      title: titulo,
      body: cuerpo,
      entityType: "Booking",
      entityId: booking.id,
    });
  }
  return true;
}

/**
 * Pregunta a Stripe si la retención sigue viva y, si no, lo deja escrito.
 *
 * Se consulta a Stripe en vez de fiarnos de la fecha guardada porque la fecha es
 * una copia: lo que manda es el estado real del PaymentIntent. Puede haberse
 * cancelado antes de tiempo (desde el panel de Stripe, por ejemplo) o haberse
 * capturado por otra vía.
 *
 * @returns {"viva"|"muerta"|"cobrada"|"desconocida"}
 */
async function estadoRealDeLaRetencion(ctx, paymentSession) {
  if (!paymentSession?.stripePaymentIntentId) return "desconocida";
  try {
    const stripe = await getStripe(ctx);
    if (!stripe) return "desconocida";
    const pi = await stripe.paymentIntents.retrieve(paymentSession.stripePaymentIntentId);
    if (pi.status === "requires_capture") return "viva";
    if (pi.status === "succeeded") return "cobrada";
    if (pi.status === "canceled") return "muerta";
    return "desconocida";
  } catch (err) {
    process.stderr.write(`[citas:retenciones] no se pudo consultar ${paymentSession.id}: ${err.message}\n`);
    return "desconocida";
  }
}

/**
 * Una pasada sobre UN tenant.
 *
 * @returns {{avisadas:number, reconciliadas:number, revisadas:number, motivo?:string}}
 */
export async function vigilarRetencionesDeTenant(ctx, { simular = false } = {}) {
  const { tenant, tenantModels } = ctx;
  const { Booking, PaymentSession, Notification, EventType } = tenantModels;
  if (!Booking || !PaymentSession) {
    return { avisadas: 0, reconciliadas: 0, revisadas: 0, motivo: "sin-citas" };
  }
  if (!tenantHasStripe(ctx)) {
    return { avisadas: 0, reconciliadas: 0, revisadas: 0, motivo: "sin-stripe" };
  }

  const ahora = Date.now();
  const limiteAviso = new Date(ahora + VENTANA_MAX_H * HORA);

  // Todo lo que tiene dinero retenido y o bien está por caducar, o bien ya
  // debería haber caducado. Las que caducan más adelante no se tocan.
  // ── Por qué NO se filtra por status: "pending" ──────────────────────────
  // Era el filtro original y dejaba un agujero: una cita CONFIRMADA con dinero
  // todavía retenido quedaba fuera de esta vigilancia, así que nadie avisaba ni
  // reconciliaba, y el importe se moría en silencio en la tarjeta del paciente.
  // Ese par no debería existir —los caminos que lo creaban están cerrados— pero
  // esto es justamente la red de debajo, y una red con un agujero del tamaño de
  // "confirmada" no es una red.
  const citas = await Booking.findAll({
    where: {
      status: { [Op.notIn]: ["cancelled", "no_show"] },
      paymentStatus: { [Op.in]: CON_RETENCION },
      authorizationExpiresAt: { [Op.ne]: null, [Op.lte]: limiteAviso },
    },
    order: [["authorizationExpiresAt", "ASC"]],
    limit: 300,
  });

  let avisadas = 0;
  let reconciliadas = 0;

  // ── Citas pegadas en 'capturing' ─────────────────────────────────────────
  // 'capturing' es un estado de PASO: dura lo que tarda una llamada a Stripe.
  // Si el proceso muere entre el marcado y la respuesta, la cita se queda ahí
  // para siempre — y era invisible para la vigilancia de arriba, que exige una
  // fecha de caducidad que estas pueden no tener. Resultado: una cita que ni se
  // cobra ni se suelta ni se ve, con dinero de alguien dentro.
  //
  // No se decide nada por nuestra cuenta: se le pregunta a Stripe qué pasó de
  // verdad con esa captura y se escribe eso.
  const PEGADA_MS = 15 * 60 * 1000;
  const pegadas = await Booking.findAll({
    where: {
      status: { [Op.notIn]: ["cancelled", "no_show"] },
      paymentStatus: "capturing",
      updatedAt: { [Op.lt]: new Date(ahora - PEGADA_MS) },
    },
    limit: 100,
  });

  for (const cita of pegadas) {
    if (simular) { reconciliadas += 1; continue; }
    const ps = cita.paymentSessionId
      ? await PaymentSession.findByPk(cita.paymentSessionId)
      : await PaymentSession.findOne({
          where: { entityType: "booking", entityId: cita.id },
          order: [["createdAt", "DESC"]],
        });

    const real = await estadoRealDeLaRetencion(ctx, ps);
    if (real === "desconocida") continue;

    if (real === "cobrada") {
      await cita.update({ paymentStatus: "paid" });
      if (ps) await ps.update({ status: "paid", paidAt: ps.paidAt ?? new Date() });
    } else if (real === "muerta") {
      await cita.update({ paymentStatus: "void", authorizationExpiresAt: null });
      if (ps) await ps.update({ status: "void" });
    } else {
      // Sigue retenida: la captura no llegó a ocurrir. Vuelve a 'authorized'
      // para que se pueda reintentar desde la lista de espera.
      await cita.update({ paymentStatus: "authorized" });
      if (ps) await ps.update({ status: "authorized" });
    }
    process.stderr.write(
      `[citas:retenciones] cita ${cita.id} estaba pegada en 'capturing' — Stripe dice '${real}'\n`
    );
    reconciliadas += 1;
  }

  for (const cita of citas) {
    const caduca = new Date(cita.authorizationExpiresAt).getTime();
    const quedanHoras = (caduca - ahora) / HORA;

    // ── Ya debería estar muerta: se comprueba y se deja escrito ─────────────
    if (quedanHoras <= 0) {
      if (simular) { reconciliadas += 1; continue; }

      const ps = cita.paymentSessionId
        ? await PaymentSession.findByPk(cita.paymentSessionId)
        : await PaymentSession.findOne({
            where: { entityType: "booking", entityId: cita.id },
            order: [["createdAt", "DESC"]],
          });

      const real = await estadoRealDeLaRetencion(ctx, ps);
      if (real === "viva" || real === "desconocida") continue; // no se toca a ciegas

      if (real === "cobrada") {
        // Alguien capturó y no nos enteramos (webhook perdido). El dinero ES
        // nuestro: se anota, que es justo lo contrario de perderlo de vista.
        await cita.update({ paymentStatus: "paid" });
        if (ps) await ps.update({ status: "paid", paidAt: ps.paidAt ?? new Date() });
      } else {
        await cita.update({ paymentStatus: "void", authorizationExpiresAt: null });
        if (ps) await ps.update({ status: "void" });
        if (Notification) {
          await avisarUnaVez({
            tenant,
            Notification,
            booking: cita,
            tipo: "hold_caducado",
            titulo: "Se ha caducado una reserva de tarjeta",
            cuerpo:
              `La reserva de ${euros(cita.amount)} de ${cita.clientName || cita.clientEmail} ` +
              `(cita del ${cuando(cita.scheduledAt)}) ha caducado sin cobrarse. ` +
              `Puedes confirmar la cita sin cobrar y cobrarle en consulta, o pedirle la tarjeta otra vez.`,
          });
        }
      }
      reconciliadas += 1;
      continue;
    }

    // ── Todavía viva: avisar según lo que quede ────────────────────────────
    if (!Notification) continue;

    // Anomalía: cita ya dada por buena y dinero sin cobrar. No se captura por
    // nuestra cuenta —mover dinero sin que nadie lo pida es peor que no
    // moverlo—, pero no puede quedarse callado.
    if (cita.status !== "pending") {
      if (simular) { avisadas += 1; continue; }
      const creado = await avisarUnaVez({
        tenant,
        Notification,
        booking: cita,
        tipo: "hold_sin_cobrar_en_cita_dada",
        titulo: "Cita confirmada con dinero sin cobrar",
        cuerpo:
          `La cita de ${cita.clientName || cita.clientEmail} del ${cuando(cita.scheduledAt)} está ` +
          `${cita.status === "completed" ? "completada" : "confirmada"} pero sus ${euros(cita.amount)} ` +
          `siguen solo reservados, sin cobrar. Revísalo antes de que la reserva caduque.`,
      });
      if (creado) avisadas += 1;
      continue;
    }

    const aviso = avisoQueToca(quedanHoras);
    if (!aviso) continue;
    if (simular) { avisadas += 1; continue; }

    const et = EventType
      ? await EventType.findByPk(cita.eventTypeId, { attributes: ["name"] })
      : null;

    const creado = await avisarUnaVez({
      tenant,
      Notification,
      booking: cita,
      tipo: aviso.tipo,
      titulo: `Caduca ${aviso.etiqueta} una reserva de tarjeta`,
      cuerpo:
        `${cita.clientName || cita.clientEmail} tiene ${euros(cita.amount)} reservados para ` +
        `${et?.name ?? "una cita"} del ${cuando(cita.scheduledAt)}. ` +
        `Si no la confirmas antes de ${cuando(cita.authorizationExpiresAt)}, la reserva se libera ` +
        `y habría que pedirle la tarjeta otra vez.`,
    });
    if (creado) avisadas += 1;
  }

  return { avisadas, reconciliadas, revisadas: citas.length };
}
