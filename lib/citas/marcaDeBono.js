/**
 * marcaDeBono — cómo se ve en la rejilla que una cita va con bono
 * (16/09/2026, AV-0162 de Aumenta: «para poder ver que son bonos y avisar a los
 * pacientes, necesitaría que aparezcan en otro color en el horario, o aún
 * mejor, con la palabra bono»).
 *
 * (Fichero nuevo en /lib, regla #2: lo lee el endpoint del calendario, que
 * pinta, y su prueba. La regla de cuándo una cita «es de bono» y cómo se rotula
 * no puede acabar suelta dentro del `map` de una ruta, donde ya vivían el
 * «3/10» y el recuento de los talleres.)
 *
 * ── QUÉ ES SER DE BONO ──────────────────────────────────────────────────────
 * Que la cita tenga `packId`: está enganchada a un bono concreto y le va a
 * descontar una sesión. NO vale «el paciente tiene un bono»: eso es otra cosa y
 * pintarlo sería mentir. Alguien miraría la rejilla, vería la marca y le diría
 * a una familia que esa sesión va con bono cuando no está descontando de
 * ningún sitio. La marca dice lo que pasa, no lo que podría pasar.
 *
 * ── LO QUE YA HABÍA, Y POR QUÉ NO BASTABA ───────────────────────────────────
 * La rejilla ya escribía «3/10 · Nombre» desde antes. Pero un número suelto no
 * dice «bono» a quien no lo sabe, que es justo lo que pedía Olga: ella coge el
 * horario para avisar a las familias y necesita leerlo de un vistazo. Así que
 * el número se queda —dice por dónde va cada persona— y delante va la palabra.
 *
 * ── HONESTIDAD DE LA MEDIDA (16/09/2026) ────────────────────────────────────
 * El día que se escribió esto, de 12.833 citas futuras de Aumenta solo UNA
 * tenía `packId`, con 231 bonos vivos. O sea: esta marca está bien puesta y
 * hoy casi no se ve, porque las citas no se enganchan a los bonos. Eso es otra
 * tarea (AV-0161) y no se arregla desde aquí. Se deja escrito para que quien
 * mire la rejilla y no vea marcas no piense que esto está roto.
 */

/**
 * El color de una cita de bono. Es una EXCEPCIÓN a propósito al color de la
 * cita —el único del centro, el de la persona o el del tipo—: el sentido de
 * todo esto es que destaque. Naranja porque no choca con ninguno de los que ya
 * se usan (el azul #9BBDC7 de Aumenta, el verde #3F6E5B de fábrica) ni con los
 * grises de las canceladas y las pasadas.
 */
export const COLOR_BONO = "#D98324";

/** ¿Esta cita descuenta de un bono? */
export function esDeBono(cita) {
  return Boolean(cita?.packId);
}

/**
 * Lo que va delante del nombre en la caja de la cita, o `null` si no va nada.
 *
 *   bono, 3 de 10   → «Bono 3/10»
 *   bono, sin número→ «Bono»
 *   sin bono, 3/10  → «3/10»   (lo de siempre: una serie de sesiones)
 *   nada de nada    → null
 */
export function etiquetaDeSesion({ esBono = false, numero = 0, total = 0 } = {}) {
  const n = Number(numero) || 0;
  const t = Number(total) || 0;
  const cuenta = n > 0 ? (t > 1 ? `${n}/${t}` : `${n}`) : null;
  if (!esBono) return cuenta;
  return cuenta ? `Bono ${cuenta}` : "Bono";
}

/**
 * El color con el que se pinta la cita: el del bono si lo es, y si no el que
 * traía. Los estados apagados (cancelada, falta, atendida) se deciden DESPUÉS
 * en el calendario y siguen mandando: una cita cancelada se tiene que ver
 * cancelada aunque fuese de bono.
 */
export function colorConBono({ esBono = false, color = null } = {}) {
  return esBono ? COLOR_BONO : color;
}
