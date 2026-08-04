/**
 * packs — bonos de sesiones: cuántas se han gastado y cuántas quedan
 * (04/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: `politicaReembolso.js` decide si se
 * devuelve DINERO al cancelar y `booking.js` monta la reserva. Ninguno sabe de
 * bonos, y lo que hay aquí lo comparten cuatro sitios —crear la reserva,
 * cobrarla, el calendario y la ficha del paciente—.)
 *
 * ── LAS SESIONES GASTADAS NO SE GUARDAN, SE CUENTAN ─────────────────────────
 * No hay ninguna columna «sesiones restantes». Se cuenta desde las propias
 * citas cada vez. Un contador hay que acordarse de bajarlo al reservar, subirlo
 * al cancelar, no tocarlo si la cancelación fue tardía, corregirlo si se
 * reprograma… y basta con olvidar UNO de esos caminos para que a alguien le
 * sobren o le falten sesiones sin que nadie sepa por qué. Las citas son la
 * verdad y siempre están.
 *
 * ── QUÉ GASTA SESIÓN (regla del contrato que firman) ────────────────────────
 *   · Realizada                                   → gasta
 *   · No se presentó, sin justificar              → gasta
 *   · Cancelada con menos de 24 h de antelación   → gasta
 *   · Cancelada con 24 h o más                    → NO gasta
 *   · No se presentó, justificada                 → NO gasta
 *   · Futura (pendiente o confirmada)             → todavía no la ha gastado,
 *     pero la tiene RESERVADA: no puede pedir otra con ese hueco.
 *
 * Es la misma frontera de 24 h que decide la devolución del dinero, y por eso
 * se importa la constante de `politicaReembolso.js` en vez de escribir otro 24:
 * si el negocio la cambia, tiene que moverse en los dos sitios a la vez.
 */

import { Op } from "sequelize";
import { HORAS_MINIMAS_PARA_REEMBOLSO } from "./politicaReembolso.js";

/**
 * 42P01 = la tabla no existe en este schema. No es un caso teórico: `healim`
 * tiene el módulo de citas y sus reservas, pero no tiene tabla de clientes, y
 * `session_packs` la referencia — así que allí nunca llegó a crearse.
 */
const esTablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** ¿Este tipo de cita se vende como bono de varias sesiones? */
export function esPack(eventType) {
  return Number(eventType?.sessionsCount ?? 1) > 1;
}

/**
 * Precios de un tipo de cita, ya resueltos para enseñarlos.
 *
 * El fraccionado es un precio INDEPENDIENTE, no `price` dividido entre los
 * meses: financiar cuesta más y el total sale mayor (360 € de golpe frente a
 * 3 × 130 = 390 €). Devolver el total calculado evita que nadie lo divida mal
 * por su cuenta.
 */
export function preciosDe(eventType) {
  const upfront = Number(eventType?.price) > 0 ? Number(eventType.price) : null;
  const cuota = Number(eventType?.instalmentPrice) > 0 ? Number(eventType.instalmentPrice) : null;
  const meses = Number(eventType?.instalmentMonths) > 1 ? Number(eventType.instalmentMonths) : null;

  return {
    upfront,
    // Los dos tienen que estar para poder ofrecerlo: una cuota sin meses no se
    // puede cobrar, y unos meses sin cuota tampoco.
    instalment: cuota && meses ? { cuota, meses, total: cuota * meses } : null,
  };
}

/** ¿Se puede pagar a plazos este tipo de cita? */
export function admiteFraccionado(eventType) {
  return !!preciosDe(eventType).instalment;
}

/**
 * ¿Esta cita ha GASTADO su sesión del bono?
 *
 * `ahora` solo se usa para las canceladas sin `cancelledAt` (citas antiguas):
 * en ese caso se compara la hora de la cita con el presente.
 */
export function gastaSesion(booking, ahora = new Date()) {
  const status = booking?.status;

  if (status === "completed") return true;

  if (status === "no_show") {
    // Tri-estado: null = falta sin clasificar. Se cuenta como gastada, que es
    // lo que dice el contrato; la profesional puede justificarla y deja de
    // contar.
    return booking?.noShowJustified !== true;
  }

  if (status === "cancelled") {
    const cita = new Date(booking?.scheduledAt);
    if (Number.isNaN(cita.getTime())) return false; // sin fecha fiable, no se le cobra la sesión
    const cancelada = booking?.cancelledAt ? new Date(booking.cancelledAt) : ahora;
    const referencia = Number.isNaN(cancelada.getTime()) ? ahora : cancelada;
    const horas = (cita.getTime() - referencia.getTime()) / 3_600_000;
    // Ante la duda (cancelación sin hora registrada), NO gasta: quitarle una
    // sesión a alguien por un dato que nos falta a nosotros no se sostiene.
    return horas < HORAS_MINIMAS_PARA_REEMBOLSO;
  }

  return false; // pending / confirmed: aún no se ha gastado
}

/** ¿Esta cita tiene la sesión RESERVADA (futura, aún sin gastar)? */
export function reservaSesion(booking) {
  return booking?.status === "pending" || booking?.status === "confirmed";
}

/**
 * Estado de un bono a partir de sus citas.
 *
 * `restantes` descuenta también las futuras: quien tiene 10 sesiones y 3 citas
 * puestas por delante no tiene 10 libres, tiene 7. Enseñarle 10 le haría pedir
 * una undécima.
 */
export function estadoPack(pack, bookings, ahora = new Date()) {
  const total = Number(pack?.totalSessions ?? 0);
  const citas = Array.isArray(bookings) ? bookings : [];

  const gastadas = citas.filter((b) => gastaSesion(b, ahora)).length;
  const reservadas = citas.filter((b) => reservaSesion(b)).length;
  const restantes = Math.max(0, total - gastadas - reservadas);

  return {
    total,
    gastadas,
    reservadas,
    restantes,
    agotado: restantes === 0,
    // Lo que se enseña en la ficha: «3 de 10 usadas, quedan 7».
    resumen: `${gastadas} de ${total} usadas${reservadas ? `, ${reservadas} reservada${reservadas === 1 ? "" : "s"}` : ""}`,
  };
}

/**
 * El siguiente número de sesión que toca.
 *
 * Se cuentan TODAS las citas del bono, incluidas las canceladas, y se toma el
 * mayor +1. Los números no se reciclan a propósito: si la sesión 3 se cancela,
 * la siguiente es la 4 y no otra 3. Lo que la profesional apuntó como «sesión
 * 3» tiene que seguir siendo la 3 dentro de un año.
 */
export function siguienteNumeroSesion(bookings) {
  const numeros = (Array.isArray(bookings) ? bookings : [])
    .map((b) => Number(b?.sessionNumber))
    .filter((n) => Number.isInteger(n) && n > 0);
  return numeros.length ? Math.max(...numeros) + 1 : 1;
}

/**
 * El bono ACTIVO de una persona para un tipo de cita, o null.
 *
 * Se busca por correo y no por ficha porque es como identifica el portal, y
 * porque hay quien reserva desde la web sin tener ficha creada todavía (mismo
 * criterio que `ClientNotice` y que las propias reservas).
 */
export async function packActivoDe(tenantModels, { email, eventTypeId }, ahora = new Date()) {
  const { SessionPack, Booking } = tenantModels;
  if (!SessionPack || !email || !eventTypeId) return null;

  let packs;
  try {
    packs = await SessionPack.findAll({
      where: {
        clientEmail: { [Op.iLike]: String(email).trim() },
        eventTypeId,
        status: "active",
      },
      order: [["purchasedAt", "ASC"]], // se gasta el más antiguo primero
    });
  } catch (err) {
    // 42P01 = la tabla no existe en este schema. Pasa de verdad: `healim` tiene
    // el módulo de citas y sus reservas, pero NO tiene tabla de clientes, así
    // que `session_packs` —que la referencia— no se pudo crear ahí.
    //
    // Sin bonos no hay nada que descontar, así que se sigue como una cita
    // suelta. Propagar el error dejaría a ese centro SIN PODER RESERVAR por una
    // función que no usa.
    if (esTablaAusente(err)) return null;
    throw err;
  }
  if (!packs.length) return null;

  // El primero que aún tenga sesiones libres. Con dos bonos comprados seguidos,
  // las citas nuevas entran en el viejo hasta agotarlo.
  for (const pack of packs) {
    const citas = await Booking.findAll({ where: { packId: pack.id } });
    const estado = estadoPack(pack, citas, ahora);
    if (!estado.agotado) return { pack, estado, bookings: citas };
  }
  return null;
}

/**
 * A qué bono se engancha una cita nueva, y con qué número de sesión.
 *
 * Devuelve `null` cuando NO hay bono con sesiones libres, que es lo que pasa
 * en dos casos muy distintos y a propósito indistinguibles aquí:
 *   · el tipo de cita es una cita suelta de siempre;
 *   · es un bono pero esta persona todavía no lo ha comprado (o lo agotó).
 * En los dos, la cita se crea como siempre y SE COBRA. El bono nace cuando el
 * pago se confirma, no al reservar: si naciera aquí, quien abandona el
 * formulario de la tarjeta se quedaría con diez sesiones sin pagar.
 *
 * Cuando SÍ hay bono, la cita no se cobra: ya está pagada.
 */
export async function asignarSesion(tenantModels, { email, eventTypeId }, ahora = new Date()) {
  const activo = await packActivoDe(tenantModels, { email, eventTypeId }, ahora);
  if (!activo) return null;
  return {
    packId: activo.pack.id,
    sessionNumber: siguienteNumeroSesion(activo.bookings),
    restantesAntes: activo.estado.restantes,
  };
}

/**
 * Los bonos de una ficha, con lo que le queda de cada uno.
 *
 * Para la ficha del paciente: «Programa 10 sesiones — le quedan 6». Devuelve
 * `[]` en cuanto algo no está (el tenant sin módulo de citas, sin la
 * migración…): la ficha no puede caerse por una sección de más.
 *
 * Se busca por correo Y por ficha: el correo es lo que ata las citas al bono,
 * pero si el centro cambió el correo de la ficha después de venderlo, el bono
 * seguiría siendo suyo.
 */
export async function bonosDeCliente(tenantModels, client) {
  const { SessionPack, Booking, EventType } = tenantModels;
  if (!SessionPack || !client) return [];

  const condiciones = [];
  if (client.email) condiciones.push({ clientEmail: { [Op.iLike]: String(client.email).trim() } });
  if (client.portalEmail) condiciones.push({ clientEmail: { [Op.iLike]: String(client.portalEmail).trim() } });
  if (client.id) condiciones.push({ clientId: client.id });
  if (!condiciones.length) return [];

  try {
    const packs = await SessionPack.findAll({
      where: { [Op.or]: condiciones },
      include: EventType ? [{ model: EventType, as: "eventType", attributes: ["id", "name"] }] : [],
      order: [["purchasedAt", "DESC"]],
    });
    if (!packs.length) return [];

    const salida = [];
    for (const pack of packs) {
      const citas = await Booking.findAll({ where: { packId: pack.id } });
      const estado = estadoPack(pack, citas);
      salida.push({
        id: pack.id,
        nombre: pack.eventType?.name ?? "Bono de sesiones",
        estado: pack.status,
        compradoEl: pack.purchasedAt,
        modoPago: pack.pricingMode,
        ...estado,
      });
    }
    return salida;
  } catch {
    // Tabla ausente (ver `esTablaAusente`) o cualquier otro tropiezo: la ficha
    // se enseña igual, solo que sin la sección de bonos.
    return [];
  }
}

/** Los dos modos de pago de un bono. */
export const PAGO_UNICO = "upfront";
export const PAGO_FRACCIONADO = "instalment";

/**
 * Qué se cobra por comprar este bono, según cómo quiera pagarlo.
 *
 * Devuelve `null` si el modo pedido no está disponible (fraccionado sin
 * configurar, por ejemplo): mejor no cobrar nada que cobrar un importe que la
 * profesional no ha puesto.
 *
 * `metodos` es la lista de métodos de pago que se le ofrecen en Stripe:
 *   · pago único   → `null` = los que el centro tenga activados (tarjeta,
 *     Bizum, y también Klarna si lo activó);
 *   · fraccionado  → SOLO Klarna, porque el importe que se cobra ES el del
 *     fraccionado (3 × 130 = 390 €). Si se dejaran todos, alguien podría pagar
 *     390 € de golpe con tarjeta teniendo la opción de 360, y con razón se
 *     sentiría estafado.
 */
export function precioDeCompra(eventType, modo = PAGO_UNICO) {
  const precios = preciosDe(eventType);

  if (modo === PAGO_FRACCIONADO) {
    if (!precios.instalment) return null;
    return {
      mode: PAGO_FRACCIONADO,
      amount: precios.instalment.total,
      instalmentAmount: precios.instalment.cuota,
      instalmentMonths: precios.instalment.meses,
      metodos: ["klarna"],
    };
  }

  if (!precios.upfront) return null;
  return {
    mode: PAGO_UNICO,
    amount: precios.upfront,
    instalmentAmount: null,
    instalmentMonths: null,
    metodos: null,
  };
}

/**
 * Crea el bono de alguien cuando su compra se confirma, y engancha la cita que
 * la originó como sesión 1.
 *
 * Se llama desde el webhook de Stripe, NO al reservar: hasta que el dinero no
 * está, no hay bono. Idempotente por `paymentSessionId`, porque Stripe reintenta
 * los webhooks y un reintento no puede regalar diez sesiones más.
 */
export async function crearPackDeCompra(tenantModels, { booking, eventType, paymentSession }, t = null) {
  const { SessionPack } = tenantModels;
  if (!SessionPack || !booking || !esPack(eventType)) return null;

  const opciones = t ? { transaction: t } : {};

  if (paymentSession?.id) {
    const ya = await SessionPack.findOne({
      where: { paymentSessionId: paymentSession.id },
      ...opciones,
    });
    if (ya) return ya; // reintento del webhook: el bono ya existe
  }

  const meta = paymentSession?.metadata ?? {};
  const fraccionado = meta.pricingMode === PAGO_FRACCIONADO;

  const pack = await SessionPack.create(
    {
      clientEmail: booking.clientEmail,
      clientId: booking.clientId ?? null,
      eventTypeId: eventType.id,
      // Foto de las sesiones que daba el bono AL COMPRARLO: si mañana el
      // programa pasa a 12, quien compró un 10 tiene 10.
      totalSessions: Number(eventType.sessionsCount) || 1,
      pricingMode: fraccionado ? PAGO_FRACCIONADO : PAGO_UNICO,
      amount: paymentSession?.amount ?? null,
      instalmentAmount: fraccionado ? (meta.instalmentAmount ?? null) : null,
      instalmentMonths: fraccionado ? (meta.instalmentMonths ?? null) : null,
      paymentSessionId: paymentSession?.id ?? null,
      purchasedAt: new Date(),
      status: "active",
    },
    opciones
  );

  // La cita que originó la compra es la sesión 1 de su propio bono.
  await booking.update({ packId: pack.id, sessionNumber: 1 }, opciones);
  return pack;
}

/** Vista para pintar: `{ numero, total, etiqueta }` o null si no es de un bono. */
export function etiquetaSesion(booking) {
  const numero = Number(booking?.sessionNumber);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  const total = Number(booking?.pack?.totalSessions) || null;
  return {
    numero,
    total,
    etiqueta: total ? `${numero}/${total}` : `Sesión ${numero}`,
  };
}
