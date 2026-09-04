/**
 * _organizate-historial.js — leer el historial clínico de Organízate.
 *
 * El historial de un paciente es una lista de entradas de TEXTO PLANO, todas
 * con la misma forma:
 *
 *   <TERAPEUTA> <Día>, <D> de <Mes>[, HH:MM] <ETIQUETA> <edad>añ  <contenido…>
 *   └ ARACELI VIGARA MÉNDEZ Jueves, 23 de Abril Reuniones con la familia 2añ …
 *
 * La ETIQUETA es lo único que dice QUÉ es cada entrada, y no viene en ningún
 * campo aparte: hay que sacarla del texto.
 *
 * ⚠️ POR QUÉ ESTO EXISTE (02/08/2026)
 *
 * El importador de sesiones filtraba con `/\bSesión\b/`, o sea «que la palabra
 * *sesión* aparezca en algún sitio del texto». Y aparece en muchas entradas que
 * NO son una sesión: un acta de coordinación que dice «lo trabajado en la
 * sesión de ayer», una cita, un fichero adjunto. Resultado: 752 entradas que
 * eran coordinaciones, reuniones con la familia, citas o adjuntos se guardaron
 * como sesiones clínicas, y en la ficha del niño salían EN BLANCO, porque no
 * tienen los bloques «Objetivo + Actividad» ni «Desempeño» que se esperaban.
 *
 * La etiqueta se lee ANCLÁNDOSE A LA EDAD (`14añ`), que va siempre justo
 * detrás, y comprobando con qué etiqueta conocida termina el texto anterior.
 * Buscarla por posición no vale: la fecha lleva coma y hora unas veces sí y
 * otras no, y contando palabras hacia atrás salía «de Octubre Sesión».
 *
 * ⚠️ LA EDAD DE LOS BEBÉS VA EN MESES (04/09/2026, AV-0041 de Aumenta)
 *
 * El ancla era solo `añ`, y a un niño de menos de dos años Organízate le
 * escribe la edad en MESES: «Sesión 23me». Esas entradas no encontraban el
 * ancla, salían «(sin edad)» y el importador las saltaba: **182 sesiones de
 * 29 pacientes se quedaron fuera del volcado del 02/08/2026**, con su texto
 * entero, por ser de los más pequeños del centro.
 *
 * El `me` se ancla con `\b` a propósito y el `añ` NO: así «23me» casa y «hace
 * 3 meses» —que puede aparecer en mitad del contenido y adelantarse al ancla
 * de verdad— no, mientras «14 años» sigue casando como siempre.
 */

/** De la más larga a la más corta: «Cita cancelada» no debe leerse «Cita». */
export const ETIQUETAS = [
  "Coordinación Interprofesional",
  "Reuniones con la familia",
  "Cita cancelada",
  "Coordinación",
  "Valoración",
  "Sesión",
  "Informe",
  "Ficheros",
  "Curso",
  "Cita",
];

/** Las que son un acta de reunión, y por tanto van al módulo Coordinaciones. */
export const ETIQUETAS_COORDINACION = new Set([
  "Coordinación",
  "Coordinación Interprofesional",
  "Reuniones con la familia",
]);

const sinAcentos = (s) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/**
 * El ancla: la edad que va justo detr\u00e1s de la etiqueta. En a\u00f1os (\u00ab14a\u00f1\u00bb, y
 * tambi\u00e9n \u00ab14 a\u00f1os\u00bb) o en meses para los m\u00e1s peque\u00f1os (\u00ab23me\u00bb). Ver la
 * cabecera para por qu\u00e9 el `me` lleva `\b` y el `a\u00f1` no.
 */
export const EDAD = /\d{1,3}\s*(?:a\u00f1|me\b)/;

/**
 * Qué es esta entrada del historial.
 * @returns una de ETIQUETAS, «(sin edad)» si no lleva el ancla, o
 *          «(no reconocido)» si lleva edad pero la etiqueta no es conocida.
 */
export function etiquetaDe(txt) {
  const i = String(txt ?? "").search(EDAD);
  if (i < 0) return "(sin edad)";
  const antes = sinAcentos(String(txt).slice(0, i)).trimEnd();
  for (const e of ETIQUETAS) if (antes.endsWith(sinAcentos(e))) return e;
  return "(no reconocido)";
}

/**
 * El DÍA de una sesión, venga como venga: «2026-02-10».
 *
 * El volcado trae la fecha como texto `YYYY-MM-DD`; la base la devuelve como
 * objeto Date, porque `clinic_sessions.session_date` es `timestamptz`. Los dos
 * tienen que dar lo mismo o cualquier comparación entre ellos falla en
 * silencio.
 *
 * De un Date se lee el día en UTC, que es como se guardaron (medianoche UTC).
 * De un texto se cogen los diez primeros caracteres sin construir un Date, que
 * es lo que evita que la zona horaria mueva el día.
 */
export function diaDe(fecha) {
  if (fecha == null) return "";
  if (fecha instanceof Date) {
    return Number.isNaN(fecha.getTime()) ? "" : fecha.toISOString().slice(0, 10);
  }
  const s = String(fecha).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * La clave con la que se sabe si una sesión del volcado ya está en el CRM:
 * paciente, día y los primeros 80 caracteres del texto original.
 *
 * ⚠️ La construyen los DOS lados de la comparación, y por eso vive aquí. El
 * 04/09/2026 cada lado normalizaba la fecha a su manera —Date por un lado,
 * texto por otro—, no casaba ninguna, la tabla entera pareció vacía y una
 * reimportación creó 22.154 sesiones duplicadas en producción.
 */
export function claveSesion(patientId, fecha, textoOriginal) {
  return `${patientId}|${diaDe(fecha)}|${String(textoOriginal ?? "").slice(0, 80)}`;
}
