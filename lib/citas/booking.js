import { Op } from "sequelize";

/**
 * Condición SQL de "esta cita OCUPA su hueco". ÚNICA fuente de verdad.
 *
 * La usan los TRES sitios que deciden si una hora está libre:
 *   · findBookingOverlap        (crear/mover una cita)
 *   · /availability             (horas libres de un día)
 *   · /availability/month       (días con hueco del mes)
 *
 * Está centralizada porque si esos tres criterios divergen se vende dos veces la
 * misma hora: uno diría "libre" y otro "ocupada" sobre la misma cita.
 *
 * Ocupa el hueco toda cita que:
 *   1. no esté cancelada ni marcada como no-show, Y
 *   2. o bien ya no está en 'pending' (confirmada o completada: es una cita de
 *      verdad en la agenda, cobrada o no), o bien no está esperando a que el
 *      PACIENTE termine de pagar (ver `ESPERANDO_AL_PACIENTE` más abajo: una
 *      cita con la tarjeta ya retenida entra por aquí y ocupa su hora aunque la
 *      profesional tarde días en confirmarla), o bien su `holdExpiresAt` sigue
 *      en el futuro.
 *
 * Solo libera el hueco una reserva que sigue 'pending' Y esperando al paciente Y
 * con el hold vencido. Es la CADUCIDAD PEREZOSA: el hueco de un carrito se
 * libera al consultarse, sin depender de ningún proceso de limpieza. Si el cron
 * se cayera, la agenda seguiría siendo correcta; con un borrado programado, un
 * fallo dejaría huecos bloqueados para siempre.
 *
 * El primer término del OR se añadió el 2026-07-28: sin él, una cita que la
 * profesional confirmaba A MANO desde el panel dejaba de ocupar su hora, porque
 * confirmar cambia `status` pero no toca `paymentStatus` ni el hold. La agenda
 * ofrecía como libre una hora que ella acababa de dar por buena.
 */
export function ocupaHuecoWhere(now = new Date()) {
  return {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    ...noEsCarritoAbandonado(now),
  };
}

/**
 * Condición "esta reserva NO es un carrito abandonado": alguien empezó a
 * reservar, se fue a pagar y no volvió.
 *
 * Se usa además en los LISTADOS (lista de espera de la profesional, "Mi perfil"
 * del paciente) como red de seguridad. El webhook `checkout.session.expired`
 * retira esas reservas, pero si no llegara —Stripe no garantiza la entrega de
 * todos los eventos para siempre— la fila seguiría ahí: la profesional vería
 * solicitudes fantasma indistinguibles de las reales y el paciente una cita
 * próxima cuyo hueco puede estar ya vendido. Filtrando también al leer, ninguna
 * de las dos cosas depende de que el evento llegue.
 */
/**
 * Estados de pago en los que la reserva DEPENDE TODAVÍA DEL PACIENTE: está a
 * medias de dar sus datos de pago y por eso su hueco caduca.
 *
 * ── EL MATIZ QUE HACE FALTA ENTENDER (sprint "cobrar al confirmar") ──────────
 * Antes solo existía 'pending' y la regla era simple: si esperas pago y se te
 * pasó el hold, eres un carrito abandonado. Con la retención de tarjeta hay dos
 * esperas muy distintas y NO pueden tratarse igual:
 *
 *   · 'authorizing' → el paciente está tecleando la tarjeta AHORA. Si se va, su
 *     hueco tiene que liberarse solo. Va aquí, con 'pending'.
 *
 *   · 'authorized'  → el dinero ya está retenido y quien tiene que actuar es la
 *     PROFESIONAL. Esa espera puede durar días y NO es un abandono: la solicitud
 *     es válida, ocupa su hora y tiene que verse en la lista de espera. NO va
 *     aquí — y ese es justo el punto donde el significado de este filtro se
 *     invierte respecto al flujo viejo.
 *
 * Si 'authorized' entrara en esta lista, el sistema escondería y liberaría el
 * hueco de citas con dinero retenido de verdad: la profesional dejaría de verlas
 * y la hora se revendería con la tarjeta del primer paciente aún comprometida.
 */
const ESPERANDO_AL_PACIENTE = ["pending", "authorizing"];

export function noEsCarritoAbandonado(now = new Date()) {
  return {
    [Op.or]: [
      { status: { [Op.ne]: "pending" } }, // confirmada o completada: cuenta siempre
      { paymentStatus: { [Op.notIn]: ESPERANDO_AL_PACIENTE } }, // gratuita, retenida, pagada…
      { holdExpiresAt: { [Op.gt]: now } }, // aún dentro de su ventana para pagar
    ],
  };
}

/**
 * Serializa las escrituras sobre la agenda mientras dure la transacción.
 *
 * Comprobar el solape y luego insertar NO basta: entre la lectura y la escritura
 * caben otras peticiones, que leen lo mismo y concluyen lo mismo. Es una carrera
 * clásica, y desde que las citas se cobran deja de ser "dos reservas a la misma
 * hora" para pasar a ser "dos personas pagando la misma hora".
 *
 * El lock es de PostgreSQL y se suelta solo al terminar la transacción (xact),
 * pase lo que pase — incluso si el proceso muere.
 *
 * La clave sale de aquí, y no escrita a mano en cada sitio, porque dos llamantes
 * con claves distintas creen estar protegidos y no se serializan entre ellos. Se
 * mantiene el mismo formato que ya usaba `reschedule-requests` para que las
 * reservas públicas y los cambios de hora del panel se serialicen ENTRE SÍ.
 *
 * Nota: los locks de aviso son de ámbito de BASE DE DATOS, no de schema, así que
 * dos tenants comparten clave. Se acepta a propósito: el lock dura lo que una
 * transacción corta, y la alternativa (meter el slug) rompería la serialización
 * con el camino de admin, que es lo que de verdad importa.
 */
export async function lockBookingSlot(sequelize, { teamMemberId = null, transaction }) {
  await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:k))", {
    replacements: { k: `booking-slot:${teamMemberId ?? "none"}` },
    transaction,
  });
}

/**
 * Comprueba si una franja [start, end) solapa con bookings que ocupan hueco.
 * Excluye opcionalmente un id.
 *
 * Usado por:
 *   - app/api/citas/bookings/route.js          (creación manual admin)
 *   - app/api/citas/bookings/[id]/route.js     (PATCH con cambio de hora)
 *   - app/api/public/c/[tenantSlug]/book/...   (creación desde landing)
 *   - lib/payments/entityHooks.js              (revalidar antes de confirmar un cobro)
 *
 * Recibe el modelo `Booking` (no la instancia tenant) para mantener el helper
 * agnóstico al pool de conexiones.
 *
 * `transaction` (2026-07-27): sin él, la comprobación lee FUERA de la transacción
 * de quien llama y no ve lo que esa misma transacción acaba de escribir, así que
 * no sirve para serializar nada. Lo necesitan los dos sitios donde ahora se
 * comprueba el hueco dentro de una transacción con lock: la reserva pública y la
 * confirmación del cobro en el webhook.
 */
export async function findBookingOverlap(
  Booking,
  { scheduledAt, duration, excludeId = null, teamMemberId = null, transaction = null }
) {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  const where = {
    ...ocupaHuecoWhere(),
    scheduledAt: { [Op.lt]: end },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  // Proyecta SOLO lo que el chequeo necesita. Así el write-path público de
  // reservas queda desacoplado de columnas FK que se añadan al modelo después:
  // un `findAll` sin `attributes` haría SELECT de todas y reventaría con 42703
  // donde una migración no hubiera corrido. `team_member_id` SÍ se incluye porque
  // es CORE (migrate-calendar-citas-fks corre en todos los tenants con bookings).
  const candidates = await Booking.findAll({
    where,
    attributes: ["id", "scheduledAt", "duration", "status", "teamMemberId"],
    ...(transaction ? { transaction } : {}),
  });
  // Solape POR PROFESIONAL: dos citas de personas distintas NO solapan (agendas
  // separadas). Una cita sin profesional asignado (null) bloquea a todos y una
  // cita nueva sin profesional choca con cualquiera — así una reserva pública
  // (siempre sin profesional) sigue respetando la ocupación general.
  const mineId = teamMemberId || null;
  for (const b of candidates) {
    const otherId = b.teamMemberId || null;
    if (mineId && otherId && mineId !== otherId) continue;
    const bStart = new Date(b.scheduledAt);
    const bEnd = new Date(bStart.getTime() + b.duration * 60 * 1000);
    if (bStart < end && bEnd > start) return b;
  }
  return null;
}
