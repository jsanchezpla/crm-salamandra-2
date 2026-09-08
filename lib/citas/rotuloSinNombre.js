/**
 * lib/citas/rotuloSinNombre.js — el nombre del paciente sale del RÓTULO de un
 * bloqueo y pasa a viajar por su enlace (08/09/2026, Rodrigo).
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 * En Aumenta hay 381 bloqueos de «reserva de plaza» cuyo rótulo lleva escrito
 * el nombre y el apellido de un niño («RESERVADO PARA <nombre>, EMPIEZA EL
 * 15/09»). Los ve todo el equipo, porque el 14/08/2026 los bloqueos dejaron de
 * seguir el filtro de visibilidad de las citas — y el motivo que se escribió
 * entonces fue, literalmente, que «un bloqueo no tiene paciente». Aquí sí lo
 * tiene, 381 veces.
 *
 * Un rótulo es texto libre: no obedece a ningún permiso, ni ahora ni el día que
 * el centro estreche la agenda. El enlace sí. Así que el nombre se va a
 * `team_blocks.patient_id` y el rótulo se queda con lo demás, que es lo que de
 * verdad le hace falta a recepción: «Reservado · empieza el 15/09».
 *
 * ── LO QUE NO HACE, Y ES LO IMPORTANTE ─────────────────────────────────────
 * **No adivina.** Solo toca el rótulo cuando UN paciente y solo uno casa por
 * nombre Y primer apellido. Con cero (el niño todavía no tiene ficha: la plaza
 * se guarda ANTES del alta) o con varios, el rótulo se queda tal cual: no se
 * puede quitar un nombre que no se sabe identificar, y vaciarlo destruiría la
 * única pista que tiene el centro.
 *
 * Esa prudencia no es teórica. Esta misma semana, emparejar por nombre para
 * decidir a quién se factura habría cambiado el pagador de 669 familias y aun
 * así se le habrían escapado los dos casos que importaban. Un rótulo escrito a
 * mano es peor material todavía que el nombre de una ficha, así que aquí la
 * regla es al revés: ante la duda, no se toca.
 */

/** Sin tildes, en mayúsculas y con los espacios domados. */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .split("")
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n < 0x300 || n > 0x36f; // fuera los diacríticos combinantes
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Las palabras de un texto, sin signos, para comparar nombre con rótulo. */
function palabras(texto) {
  return normalizar(texto)
    .split(/[^A-ZÑ0-9]+/)
    .filter(Boolean);
}

/**
 * Las palabras del nombre de un paciente que sirven para reconocerlo: las de
 * tres letras o más. «Ana» pasa; «de», «la» y «y» no, que están en media
 * España y harían casar cualquier cosa.
 */
export function palabrasDelNombre(paciente) {
  return [...palabras(paciente?.firstName), ...palabras(paciente?.lastName)].filter((p) => p.length >= 3);
}

/**
 * ¿Casa este paciente con este rótulo? Hacen falta su NOMBRE y su PRIMER
 * apellido, los dos, y los dos de tres letras o más.
 *
 * El primer apellido y no el segundo porque en un rótulo escrito a mano rara
 * vez está el segundo, y exigir los dos dejaría fuera casi todos. Exigir solo
 * el nombre, en cambio, casaría a todas las Lucías del centro.
 */
export function pacienteCasaConRotulo(paciente, rotulo) {
  const enElRotulo = new Set(palabras(rotulo));
  const nombre = palabras(paciente?.firstName)[0];
  const apellido = palabras(paciente?.lastName)[0];
  if (!nombre || !apellido) return false;
  if (nombre.length < 3 || apellido.length < 3) return false;
  return enElRotulo.has(nombre) && enElRotulo.has(apellido);
}

/**
 * El paciente de un rótulo, o null si no hay UNO solo.
 *
 * Devolver null con varios candidatos es la mitad del valor de esta función:
 * dos hermanos con el mismo primer apellido y nombres parecidos son
 * exactamente el caso en el que acertar por azar es peor que no tocar nada.
 */
export function pacienteDelRotulo(rotulo, pacientes = []) {
  const casan = (Array.isArray(pacientes) ? pacientes : []).filter((p) => pacienteCasaConRotulo(p, rotulo));
  return casan.length === 1 ? casan[0] : null;
}

/** Palabras que solas no dicen nada y no deben quedarse colgando al final. */
const COLGANDO = new Set(["PARA", "DE", "DEL", "A", "AL", "CON", "Y"]);

/**
 * El rótulo sin las palabras del nombre de ese paciente, aseado.
 *
 * Se quitan PALABRAS, no una cadena: en el rótulo el nombre aparece como lo
 * escribió una persona («Reservado Andrés Isaí, comienza…»), que casi nunca es
 * el `firstName + lastName` de la ficha. Lo que no es del nombre se conserva
 * TAL CUAL, con sus mayúsculas y su fecha, porque eso es lo que usa recepción.
 */
export function rotuloSinPaciente(rotulo, paciente) {
  const original = String(rotulo ?? "");
  const fuera = new Set(palabrasDelNombre(paciente));
  if (!fuera.size) return original;

  // Se recorre el rótulo trozo a trozo conservando los separadores, para no
  // perder la coma ni el «·» que separan la fecha.
  const piezas = original.split(/([^\p{L}\p{N}]+)/u);
  const quedan = piezas.map((pieza, i) => {
    if (i % 2 === 1) return pieza; // separador
    return fuera.has(normalizar(pieza)) ? "" : pieza;
  });

  let salida = quedan.join("");
  // Aseo: separadores que se quedaron sin nada a un lado, y palabras repetidas
  // seguidas («Reservado Reservado», que viene así de Organízate).
  salida = salida
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,\s*/g, ", ")
    .replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1")
    .replace(/\s+([,;.·])/g, "$1")
    .replace(/^[\s,;.·\-–—]+/, "")
    .replace(/[\s,;.·\-–—]+$/, "")
    .trim();

  /*
   * Un «para» o un «de» que se quedaron sin su nombre detrás. Hay dos sitios
   * donde pasa y hacen falta los dos: justo antes de una coma —«RESERVADO
   * PARA, EMPIEZA EL 15/09»— y al final del todo.
   */
  salida = salida
    // El lookbehind, y no \b: con la bandera `u` esa marca se guía por
    // ASCII, y una «y» dentro de «HOY,» se iría por delante.
    .replace(/(?<![\p{L}\p{N}])(?:para|del?|con|al?|y)\s*(?=[,;.·])/giu, "")
    .replace(/\s+([,;.·])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const trozos = salida.split(" ").filter(Boolean);
  while (trozos.length && COLGANDO.has(normalizar(trozos[trozos.length - 1]))) trozos.pop();
  salida = trozos.join(" ").replace(/\s+([,;.·])/g, "$1").replace(/[\s,;.·\-–—]+$/, "").trim();

  // Un rótulo vacío sería peor que el que había: al menos dice que está dado.
  if (!salida || !/\p{L}/u.test(salida)) return "Reservado";
  return salida.slice(0, 120);
}

/**
 * Lo que hay que hacer con un bloqueo: a qué paciente se engancha y con qué
 * rótulo se queda. `null` = no se toca.
 *
 * Es la pieza que comparten la copia de Organízate —para que la siguiente
 * pasada no vuelva a meter el nombre— y el arreglo de lo que ya está guardado.
 * Que sea la MISMA evita lo de siempre: que una limpie y la otra reponga.
 */
export function despiezarRotulo(rotulo, pacientes = []) {
  const paciente = pacienteDelRotulo(rotulo, pacientes);
  if (!paciente) return null;
  const limpio = rotuloSinPaciente(rotulo, paciente);
  if (limpio === String(rotulo ?? "")) return null; // no había nada que quitar
  return { patientId: paciente.id, label: limpio };
}
