/**
 * lib/billing/pacienteDelBono.js — de quién es un bono que no dice de quién es
 * (18/09/2026, AV-0159 de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: la misma regla la necesitan CUATRO sitios
 * —la lista de bonos al pintarla, las dos puertas del alta y la renovación—.
 * Escrita cuatro veces acabaría diciendo cosas distintas en cada pantalla, que
 * es justo lo que ya pasó con las sesiones antes de `bonosConSesiones.js`.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * Rosa, 16/09/2026: en Facturación → Bonos le salían tres bonos con el paciente
 * en blanco —«de la familia»— y la ficha al lado con el nombre de un niño. Como
 * la lista va por fecha, los tres caían seguidos y se leían como si tres
 * pacientes que no tienen nada que ver estuvieran metidos en la misma familia.
 * El 17/09 insistió: «ES QUE NO SON FAMILIA, ESE ES EL PROBLEMA».
 *
 * Y tenía razón en lo que importa: los tres bonos son de tres familias
 * distintas, y **cada una de esas familias tiene UN SOLO paciente**. Ahí «de la
 * familia» no distingue nada de nada: el único que puede gastar ese bono es ese
 * niño. Decirlo con su nombre no es adivinar, es leer lo que ya hay.
 *
 * ── LO QUE ESTA REGLA NO HACE ──────────────────────────────────────────────
 * Con DOS hermanos o más, un bono sin paciente sigue siendo de la familia
 * entera y se sigue diciendo así: ahí no hay ningún nombre que poner y
 * elegir uno sería inventarse el dato. En Aumenta hay 82 familias con varios
 * hijos y ni un solo bono suelto entre ellas (comprobado en producción el
 * 18/09/2026); esto es exactamente para las que tienen uno.
 *
 * Tampoco toca la base: la columna `session_packs.patient_id` se queda como
 * está. Lo que cambia es lo que se RESPONDE al pintar (`bonosConSesiones.js`,
 * que marca esos bonos con `pacienteDeducido`) y lo que se GUARDA a partir de
 * ahora en los bonos nuevos (las dos puertas del alta).
 */

/** El nombre de un paciente tal y como lo enseña Facturación. */
export function nombreDePaciente(p) {
  return `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim() || "(sin nombre)";
}

/**
 * EL ÚNICO PACIENTE DE UNA FAMILIA, o `null` si no lo hay.
 *
 * `null` con cero pacientes (una ficha que todavía no tiene a nadie) y `null`
 * con dos o más (ahí el bono es de la familia de verdad). Solo responde cuando
 * la respuesta no admite discusión.
 *
 * @param {Array<{id: *, firstName?: string, lastName?: string}>} pacientes
 * @returns {?{id: *, nombre: string}}
 */
export function unicoPacienteDe(pacientes = []) {
  const lista = Array.isArray(pacientes) ? pacientes.filter((p) => p && p.id != null) : [];
  if (lista.length !== 1) return null;
  const p = lista[0];
  return { id: p.id, nombre: nombreDePaciente(p) };
}

/**
 * Lo mismo para VARIAS familias de una vez: mapa `clientId` -> `{ id, nombre }`
 * con solo las que tienen un único paciente.
 *
 * Recibe los pacientes en plano —como vuelven de una consulta con `IN (…)`— para
 * que la lista de bonos resuelva sus 244 filas con UNA consulta y no con una por
 * familia, que es la misma razón por la que existe `bonosConSesiones.js`.
 *
 * @param {Array<{id: *, clientId: *, firstName?: string, lastName?: string}>} pacientes
 * @returns {Map<string, {id: *, nombre: string}>}
 */
export function pacienteUnicoPorFamilia(pacientes = []) {
  const porFamilia = new Map();
  for (const p of Array.isArray(pacientes) ? pacientes : []) {
    if (!p || p.id == null || p.clientId == null) continue;
    const clave = String(p.clientId);
    if (!porFamilia.has(clave)) porFamilia.set(clave, []);
    porFamilia.get(clave).push(p);
  }
  const unicos = new Map();
  for (const [clave, suyos] of porFamilia) {
    const uno = unicoPacienteDe(suyos);
    if (uno) unicos.set(clave, uno);
  }
  return unicos;
}

/**
 * EL PACIENTE QUE LE FALTABA AL BONO, preguntándoselo a la base.
 *
 * La mitad que necesita Sequelize, y la que usan las dos puertas del alta: si
 * quien da el bono no dijo de quién es y la familia tiene un solo paciente, se
 * guarda ese. Es lo que el cajón de la ficha ya hacía a mano desde el 08/09
 * (preselecciona al único hijo) y lo que el de Facturación no podía hacer,
 * porque su buscador solo ofrece pacientes y nunca llega aquí con la familia
 * sola. Por eso la regla baja al servidor: es el único sitio por el que pasan
 * las dos puertas, y lo que entró por la de atrás es justo lo que Rosa vio.
 *
 * Devuelve `{ id, nombre }` o `null`. No revienta nunca —un centro sin
 * pacientes, sin tabla o sin ficha se queda como estaba—: esto afina un dato,
 * no autoriza nada.
 */
export async function deduceElPacienteUnico({ tenantModels, clientId } = {}) {
  const Patient = tenantModels?.Patient;
  if (!Patient || !clientId) return null;
  try {
    const suyos = await Patient.findAll({
      where: { clientId },
      attributes: ["id", "firstName", "lastName"],
      // Con dos ya no hay nada que deducir: no hace falta traerse a los ocho.
      limit: 2,
      raw: true,
    });
    return unicoPacienteDe(suyos);
  } catch {
    // Sin tabla de pacientes (42P01) o sin la columna: el bono se queda de la
    // familia, que es como estaba antes de esta regla.
    return null;
  }
}
