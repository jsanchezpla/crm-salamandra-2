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
 * Qué es esta entrada del historial.
 * @returns una de ETIQUETAS, «(sin edad)» si no lleva el ancla, o
 *          «(no reconocido)» si lleva edad pero la etiqueta no es conocida.
 */
export function etiquetaDe(txt) {
  const i = String(txt ?? "").search(/\d{1,2}\s*añ/);
  if (i < 0) return "(sin edad)";
  const antes = sinAcentos(String(txt).slice(0, i)).trimEnd();
  for (const e of ETIQUETAS) if (antes.endsWith(sinAcentos(e))) return e;
  return "(no reconocido)";
}
