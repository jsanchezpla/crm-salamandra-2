/**
 * lib/citas/borrarCita.js — borrar una cita PARA SIEMPRE, en un solo sitio
 * (12/09/2026, Rodrigo: «si borro o muevo una cita, que me proponga
 * borrarla/moverla y todas las citas futuras, por si me he equivocado»).
 *
 * ── POR QUÉ SALE DE LA RUTA ─────────────────────────────────────────────────
 * Esto vivía dentro de `app/api/citas/bookings/[id]/route.js`, y mientras solo
 * se borrara de un sitio estaba bien. Desde hoy se borra también EN BLOQUE
 * —esta y las que son su repetición de aquí en adelante,
 * `app/api/citas/bookings/[id]/siguientes`— así que son DOS rutas haciendo lo
 * mismo. Escrito dos veces, a la segunda una de las dos se olvida de mirar el
 * dinero o deja colgando la sesión de cobro (regla #2 del CLAUDE.md).
 *
 * ── QUÉ SE VA CON LA CITA ───────────────────────────────────────────────────
 * Lo que cuelga de ella y quedaría apuntando al vacío: su sesión de cobro
 * (`payment_sessions`), las peticiones de cambio de hora (`booking_change_
 * requests`, cuyo `booking_id` es NOT NULL) y los avisos que nacieron de ella
 * (`client_notices`). Mismo barrido que `scripts/borrar-citas-por-nombre.js`.
 *
 * Sin transacción a propósito: una sentencia que falla dentro de una
 * transacción de PostgreSQL la deja abortada, y aquí hay que tolerar que a un
 * tenant le falte alguna de esas tablas. Se borra de fuera hacia dentro y la
 * cita la última; si algo se tuerce, lo que queda son filas sueltas que ya no
 * significan nada, no una cita a medio borrar.
 *
 * ── LO QUE NO SE BORRA ──────────────────────────────────────────────────────
 * · Una cita con dinero (cobrada, retenida o devuelta) NO se borra: el rastro
 *   del dinero tiene que quedar. Se dice y se ofrece cancelarla.
 * · El bono. Si la cita era una sesión de un bono, esa sesión vuelve a quedar
 *   libre — las sesiones se cuentan desde las citas (`lib/citas/packs.js`), así
 *   que borrar la cita es exactamente eso: no se dio.
 * · La auditoría. Es el ÚNICO rastro que queda de la cita, y la escribe quien
 *   llama (una línea por cita al borrar una; una con el recuento al borrar la
 *   serie).
 */

import { Op } from "sequelize";

/**
 * Estados de cobro en los que hay DINERO de verdad de por medio.
 *
 * `authorized` es una retención viva en la tarjeta de alguien, `paid` un
 * ingreso y `refunded` una devolución ya hecha: los tres son registros
 * contables. Los demás (`pending`, `authorizing`, `failed`, `expired`, `void`)
 * son intentos que no movieron nada y se pueden tirar con la cita.
 */
export const COBROS_CON_DINERO = Object.freeze({
  paid: "está cobrada",
  authorized: "tiene una retención en la tarjeta",
  refunded: "tiene una devolución registrada",
});

/**
 * 42P01 = esa tabla no existe en este schema. Pasa de verdad en tenants con
 * schema parcial, y no puede impedir borrar una cita.
 */
export const esTablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

async function borrarSiExiste(modelo, where) {
  if (!modelo) return 0;
  try {
    return await modelo.destroy({ where });
  } catch (err) {
    if (esTablaAusente(err)) return 0;
    throw err;
  }
}

/**
 * ¿Hay dinero que impida borrar esta cita? Devuelve el motivo en cristiano
 * («está cobrada») o `null` si se puede borrar.
 */
export async function dineroQueImpideBorrar(tenantModels, bookingId) {
  const { PaymentSession } = tenantModels;
  if (!PaymentSession) return null;
  try {
    const fila = await PaymentSession.findOne({
      where: {
        entityType: "booking",
        entityId: bookingId,
        status: { [Op.in]: Object.keys(COBROS_CON_DINERO) },
      },
      attributes: ["id", "status"],
    });
    return fila ? COBROS_CON_DINERO[fila.status] : null;
  } catch (err) {
    if (esTablaAusente(err)) return null;
    throw err;
  }
}

/** Lo poco que se guarda de una cita borrada: sin datos de salud, con lo que la identifica. */
export function huellaDeCita(row) {
  return {
    cliente: row.clientName,
    scheduledAt: row.scheduledAt,
    estado: row.status,
    eventTypeId: row.eventTypeId,
    teamMemberId: row.teamMemberId,
    sessionNumber: row.sessionNumber ?? null,
  };
}

/**
 * Borra la cita y lo que colgaba de ella.
 *
 * @returns `{ ok: false, freno }` si tiene dinero de por medio (y no se toca
 *   nada), o `{ ok: true, huella, colgantes: { cobros, cambios, avisos } }`.
 *   Quien llama es quien audita.
 */
export async function borrarCitaDeVerdad({ tenantModels, row }) {
  const freno = await dineroQueImpideBorrar(tenantModels, row.id);
  if (freno) return { ok: false, freno };

  const { PaymentSession, BookingChangeRequest, ClientNotice } = tenantModels;
  const huella = huellaDeCita(row);
  const cobros = await borrarSiExiste(PaymentSession, { entityType: "booking", entityId: row.id });
  const cambios = await borrarSiExiste(BookingChangeRequest, { bookingId: row.id });
  const avisos = await borrarSiExiste(ClientNotice, { bookingId: row.id });
  await row.destroy();
  return { ok: true, huella, colgantes: { cobros, cambios, avisos } };
}
