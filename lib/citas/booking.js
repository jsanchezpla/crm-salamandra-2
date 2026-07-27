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
 *   2. no sea una reserva provisional CADUCADA — es decir, o no está esperando
 *      pago, o su `holdExpiresAt` sigue en el futuro.
 *
 * El punto 2 es la CADUCIDAD PEREZOSA: el hueco de un carrito abandonado se
 * libera al consultarse, sin depender de ningún proceso de limpieza. Si el cron
 * se cayera, la agenda seguiría siendo correcta; con un borrado programado, un
 * fallo dejaría huecos bloqueados para siempre.
 */
export function ocupaHuecoWhere(now = new Date()) {
  return {
    status: { [Op.notIn]: ["cancelled", "no_show"] },
    [Op.or]: [
      { paymentStatus: { [Op.ne]: "pending" } }, // gratuita, pagada, fallida…
      { holdExpiresAt: { [Op.gt]: now } }, // reserva provisional aún viva
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
