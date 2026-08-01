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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida el profesional que se asigna a una entrada de la cola.
 *
 * Devuelve el id si existe en la plantilla del tenant, `null` si no se ha
 * indicado ninguno —entrar sin terapeuta es el caso NORMAL de una cola de
 * espera— y `false` si el id no corresponde a nadie.
 *
 * Se distingue `null` de `false` a propósito: «no asignar» y «asignar a alguien
 * que no existe» son cosas distintas, y la segunda tiene que dar error en vez
 * de guardarse en silencio y aparecer como «sin asignar» sin que nadie entienda
 * por qué.
 *
 * Vive aquí y no en el endpoint porque en Next.js un fichero de ruta solo puede
 * exportar métodos HTTP: exportar un helper desde ahí rompe el build.
 */
export async function terapeutaValido(ctx, valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const id = String(valor);
  // Se comprueba la FORMA antes de consultar: PostgreSQL revienta la query
  // entera ("invalid input syntax for type uuid") si le llega cualquier cosa en
  // una columna UUID, y eso convertiría un dato mal escrito en un 500.
  if (!UUID_RE.test(id)) return false;
  const TeamMember = ctx?.tenantModels?.TeamMember;
  if (!TeamMember) return false;
  const existe = await TeamMember.findOne({ where: { id }, attributes: ["id"] });
  return existe ? id : false;
}

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
