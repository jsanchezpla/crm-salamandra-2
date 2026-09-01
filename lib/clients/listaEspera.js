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

import { terapeutaAPacientesDeFamilia } from "./profesionalFamilia.js";

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
 * Al ACEPTAR una entrada de la cola («ya tiene plaza»), el terapeuta que se le
 * asignó esperando se lleva a donde el resto del CRM lo mira. Sin esto la
 * asignación se quedaba en la entrada convertida y nadie la volvía a leer: la
 * cola prometía «se entra sin terapeuta y se sale con uno», pero al salir el
 * paciente seguía sin él y registrar una sesión lo rebotaba (31/08/2026,
 * Rodrigo, con el paciente de prueba de Aumenta).
 *
 * Dos destinos, los dos SIN pisar nada ya decidido:
 *
 *   · Los PACIENTES de esa familia que no tengan terapeuta: se les pone como
 *     el de referencia, por `sincronizarTerapeutas` (la misma puerta que la
 *     ficha, con su validación contra el equipo y su espejo). Un paciente que
 *     ya tiene terapeuta no se toca — eso lo decidió alguien en su ficha.
 *   · El «Profesional de referencia» de la FAMILIA, solo si estaba vacío: ese
 *     campo gobierna su agenda pública y quién ve una consulta externa, y una
 *     asignación hecha a mano no se pisa desde una cola.
 *
 * Devuelve `{ pacientes, familia }`: a cuántos pacientes llegó y si se puso el
 * de la familia. Con módulos a medias degrada en silencio: sin módulo clínico
 * (o sin la tabla `patients` en ese schema, 42P01/42703) solo toca la familia.
 */
export async function propagarTerapeutaAlAceptar({ ctx, clientId, terapeutaId, transaction = null }) {
  const salida = { pacientes: 0, familia: false };
  if (!clientId || !terapeutaId) return salida;
  const { Client } = ctx?.tenantModels ?? {};
  const conTx = transaction ? { transaction } : {};

  if (Client) {
    const familia = await Client.findByPk(clientId, conTx);
    if (familia && !familia.assignedTeamMemberId) {
      await familia.update({ assignedTeamMemberId: terapeutaId }, conTx);
      salida.familia = true;
    }
  }

  // La misma regla que la ficha de la familia: el profesional llega a los
  // pacientes SIN terapeuta (lib/clients/profesionalFamilia.js, con sus
  // puertas de módulo y su degradación de schema a medias dentro).
  salida.pacientes = await terapeutaAPacientesDeFamilia({ ctx, clientId, terapeutaId, transaction });
  return salida;
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
