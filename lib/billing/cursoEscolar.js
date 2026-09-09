/**
 * lib/billing/cursoEscolar.js — el CURSO (septiembre a junio) como unidad de
 * tiempo de la facturación (09/09/2026, petición de Aumenta: «crear, modificar
 * o eliminar cuotas de todos los meses del curso escolar (SEP-JUN)»).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos —
 * qué meses tiene un curso, a qué curso pertenece un mes y cómo se llama—,
 * compartida por la API de los tipos de cuota y su pantalla, y fijada por
 * `scripts/_smoke-curso-escolar.mjs` sin levantar nada.)
 *
 * ── POR QUÉ EL AÑO NATURAL NO SIRVE AQUÍ ───────────────────────────────────
 * El centro no piensa en años: piensa en cursos. «La cuota de Hugo este año»
 * es de septiembre a junio, y ese tramo cruza el 31 de diciembre por la mitad.
 * Una rejilla de enero a diciembre parte el curso en dos y deja fuera lo que
 * de verdad se quiere repasar de una vez. Julio y agosto no están: el centro
 * cierra, y un mes sin cuota que sale en la rejilla es una casilla vacía que
 * alguien acabará rellenando por error.
 *
 * El AÑO CONTABLE sigue siendo el natural —las facturas se numeran por
 * ejercicio y así se declaran—: esto no lo toca. Es la vista de la cuota.
 */

import { mesVigente } from "./cuotas.js";

/** Los meses del curso, en orden: septiembre a diciembre y enero a junio. */
const MESES_PRIMERA_MITAD = [9, 10, 11, 12];
const MESES_SEGUNDA_MITAD = [1, 2, 3, 4, 5, 6];

const NOMBRES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dosDigitos = (n) => String(n).padStart(2, "0");

/** ¿Es 'AAAA-MM'? */
export function mesDelCursoValido(mes) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes ?? ""));
}

/**
 * A qué curso pertenece un mes. El curso se nombra por el año en que EMPIEZA:
 * '2026-10' y '2027-03' son los dos del curso 2026 (2026/27).
 *
 * Julio y agosto no son de nadie, y aquí se cuentan como del curso que ACABA
 * de terminar: en julio se cierra la facturación de junio, no se mira ya el
 * curso que viene.
 */
export function cursoDeMes(mes) {
  if (!mesDelCursoValido(mes)) return null;
  const [anio, m] = String(mes).split("-").map(Number);
  return m >= 9 ? anio : anio - 1;
}

/** El curso en el que estamos hoy (hora de Madrid, como el resto del dinero). */
export function cursoVigente(ahora = new Date()) {
  return cursoDeMes(mesVigente(ahora));
}

/** Los diez meses del curso, de septiembre a junio. */
export function mesesDelCurso(curso) {
  const a = Number(curso);
  if (!Number.isInteger(a)) return [];
  return [
    ...MESES_PRIMERA_MITAD.map((m) => `${a}-${dosDigitos(m)}`),
    ...MESES_SEGUNDA_MITAD.map((m) => `${a + 1}-${dosDigitos(m)}`),
  ];
}

/** ¿Cae este mes dentro del curso? (julio y agosto, nunca). */
export function esDelCurso(mes, curso) {
  return mesesDelCurso(curso).includes(String(mes));
}

/** «2026/27», que es como lo escribe el centro. */
export function rotuloCurso(curso) {
  const a = Number(curso);
  if (!Number.isInteger(a)) return "";
  return `${a}/${dosDigitos((a + 1) % 100)}`;
}

/** «2026-09» → «sep», para la cabecera de la rejilla. */
export function mesCorto(mes) {
  if (!mesDelCursoValido(mes)) return String(mes ?? "");
  return NOMBRES[Number(String(mes).slice(5, 7)) - 1];
}

/** «2026-09» → «sep 26», cuando hace falta desempatar el año. */
export function mesConAnio(mes) {
  if (!mesDelCursoValido(mes)) return String(mes ?? "");
  return `${mesCorto(mes)} ${String(mes).slice(2, 4)}`;
}

/**
 * Los cursos que se ofrecen en el desplegable: el vigente, los de atrás y uno
 * hacia delante (en junio ya se está montando el curso siguiente).
 */
export function cursosParaElegir(vigente = cursoVigente(), { atras = 3, adelante = 1 } = {}) {
  const a = Number(vigente);
  if (!Number.isInteger(a)) return [];
  const lista = [];
  for (let i = a + adelante; i >= a - atras; i -= 1) lista.push(i);
  return lista;
}

/** El primer y el último día del curso, para acotar una consulta. */
export function tramoDelCurso(curso) {
  const meses = mesesDelCurso(curso);
  if (!meses.length) return null;
  return { desde: `${meses[0]}-01`, hasta: `${meses[meses.length - 1]}-30` };
}
