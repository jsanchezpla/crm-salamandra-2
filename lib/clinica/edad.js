/**
 * lib/clinica/edad.js — la edad de un paciente, calculada desde su fecha de
 * nacimiento (03/09/2026, AV-0034 de Aumenta: «para elaborar informes es
 * necesario tener la fecha de nacimiento y la edad correspondiente»).
 *
 * (Regla #2: estaba dentro de objetivosIa.js, que la escribió para el prompt
 * de la IA. Ahora la necesitan también el serializador de la ficha, el listado
 * y los informes, y una edad calculada en dos sitios acaba distinta el día del
 * cumpleaños. objetivosIa.js la sigue exportando desde aquí.)
 *
 * ── LA FECHA MANDA SOBRE LA EDAD ESCRITA ────────────────────────────────────
 * `patients` tiene las dos columnas desde el principio: `birth_date` (que la
 * importación de Organízate rellenó en 988 de 1.181 pacientes de Aumenta) y
 * `age` (18). La edad escrita a mano se queda vieja cada cumpleaños; la fecha
 * no. Por eso, cuando hay fecha, la edad se calcula y la casilla «Edad» solo
 * cuenta para quien no sabe la fecha.
 */

/** Edad en años a `hoy` desde `birthDate`; si no hay fecha válida, la `age` guardada; si no, null. */
export function edadDe(paciente, hoy = new Date()) {
  const f = paciente?.birthDate ? new Date(paciente.birthDate) : null;
  if (f && !Number.isNaN(f.getTime())) {
    let edad = hoy.getFullYear() - f.getFullYear();
    const m = hoy.getMonth() - f.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < f.getDate())) edad -= 1;
    if (edad >= 0 && edad <= 120) return edad;
  }
  const n = Number(paciente?.age);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}

/**
 * La fecha de nacimiento para leerla: «12/03/2017». Acepta el DATEONLY de
 * Sequelize («2017-03-12») y cualquier ISO; devuelve "" si no hay fecha o no
 * se entiende, para poder concatenarla sin comprobar antes.
 */
export function fechaNacimientoCorta(birthDate) {
  if (!birthDate) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
