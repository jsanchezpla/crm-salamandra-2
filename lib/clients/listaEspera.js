/**
 * lib/clients/listaEspera.js — entrar en la lista de espera de ADMISIÓN.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint de la lista y el
 * alta de clientes, que desde el 01/08/2026 puede meter a la familia en la cola
 * en el mismo momento en que se le abre la ficha.)
 *
 * ⚠️ No confundir con la «lista de espera» de Citas: aquella son solicitudes de
 * reserva con fecha y hora pedidas. Esta es gente esperando PLAZA, por orden de
 * llegada.
 *
 * La posición se calcula leyendo la última: es una cola de decenas de familias,
 * no hace falta un contador, y un contador guardado es una cosa más que se
 * puede desincronizar.
 */

/** Siguiente hueco de la cola. Dentro de la transacción si se le pasa una. */
export async function siguientePosicion(WaitlistEntry, transaction = null) {
  const ultima = await WaitlistEntry.findOne({
    order: [["position", "DESC"]],
    attributes: ["position"],
    ...(transaction ? { transaction } : {}),
  });
  return (ultima?.position ?? 0) + 1;
}

/**
 * Mete a un cliente YA CREADO en la cola.
 *
 * Se queda en `active` con su `clientId` puesto, no en `converted`: la familia
 * tiene ficha pero sigue esperando plaza, que es justo el caso que faltaba.
 * `converted` significa «ya entró», y marcarlo aquí la sacaría de la cola el
 * mismo día que se apuntó.
 */
export async function entrarEnListaEspera({ WaitlistEntry, client, notes = null, specialty = null, transaction = null }) {
  if (!WaitlistEntry || !client) return null;
  const position = await siguientePosicion(WaitlistEntry, transaction);
  return WaitlistEntry.create(
    {
      name: client.name,
      email: client.email || null,
      phone: client.phone || null,
      specialty: specialty || null,
      notes: notes || null,
      status: "active",
      position,
      clientId: client.id,
    },
    transaction ? { transaction } : {}
  );
}

/**
 * La entrada VIVA de un cliente, si la tiene. Devuelve `null` sin ruido cuando
 * el módulo no está activo o la tabla no existe todavía en ese schema: la ficha
 * no puede romperse por una sección que no todos tienen.
 */
export async function entradaDeCliente(WaitlistEntry, clientId) {
  if (!WaitlistEntry || !clientId) return null;
  try {
    return await WaitlistEntry.findOne({
      where: { clientId, status: "active" },
      order: [["position", "ASC"]],
    });
  } catch (err) {
    if (err?.parent?.code === "42P01" || err?.original?.code === "42P01") return null;
    throw err;
  }
}
