/**
 * lib/clinica/apartadosPropuestos.js — que la IA pueda proponer APARTADOS QUE
 * NO EXISTEN todavía en el documento (04/09/2026, Rodrigo: «la transcripción de
 * Claude observa los campos existentes y añade nuevos automáticamente si así lo
 * decide»).
 *
 * (Fichero nuevo en /lib, regla #2: la misma pieza —el trozo de prompt y el
 * parseo de lo que vuelve— la necesitan los TRES documentos que se dictan: el
 * registro de sesión (`registroCompleto.js`), la entrevista inicial (que es un
 * registro con su plantilla) y el informe clínico (`informeMaterial.js`). Con
 * una copia en cada uno, un apartado propuesto entraría con reglas distintas
 * según por dónde se dictara.
 *
 * Y va en un fichero propio y no dentro de `registroCompleto.js` para no crear
 * un ciclo de imports: el informe necesita ESTO y `registroCompleto` necesita
 * esto también, así que esto no puede necesitar a ninguno de los dos.)
 *
 * ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
 * Hasta hoy el prompt decía «EXACTAMENTE una clave por apartado de la lista y
 * ninguna más». Es la regla que hace que la propuesta caiga siempre en
 * apartados que existen —y hay que conservarla—, pero tiene un coste: lo que la
 * profesional cuenta y no cabe en ningún apartado de su plantilla se PIERDE.
 * Ni se escribe en ningún sitio ni se avisa de que se ha tirado. Con plantillas
 * que decide cada centro, eso pasa a menudo: se dicta «la madre trae el informe
 * del neurólogo» en un centro cuya plantilla no tiene dónde poner eso.
 *
 * Ahora el modelo puede devolver, además, una clave `nuevos` con apartados que
 * se INVENTA él —título, tipo y contenido—, y la pantalla los enseña aparte,
 * marcados como nuevos, para que la profesional los acepte o los descarte. Que
 * los decida el modelo no significa que entren solos: eso sigue siendo la regla
 * de la casa (`PropuestaIA`).
 *
 * ── LOS DOS CERROJOS ───────────────────────────────────────────────────────
 *  1. **Tope y limpieza.** Máximo `MAX_NUEVOS` por pasada, título obligatorio,
 *     clave calculada con `slugApartado` (la misma que usa la pantalla al
 *     añadir uno a mano) y jamás una que ya esté en el documento: un apartado
 *     nuevo que pisara la clave de otro le borraría el texto al guardar.
 *  2. **Vacío = no existe.** Un apartado propuesto sin contenido no es una
 *     propuesta, es una casilla más que rellenar; se tira.
 */

import { slugApartado, CLAVES_RESERVADAS } from "./plantillas.js";

/** Dónde vienen los apartados nuevos dentro del JSON que devuelve el modelo. */
export const CLAVE_NUEVOS = "nuevos";

/**
 * Cuántos puede proponer de una vez. Cuatro y no treinta: esto es la válvula
 * para lo que no cabe en la plantilla, no una forma de que el modelo se monte
 * el documento entero. Si de un audio salen cuatro apartados nuevos, lo que
 * hace falta es revisar la plantilla del centro, no aceptar veinte.
 */
export const MAX_NUEVOS = 4;

const texto = (v) => (v == null ? "" : String(v).trim());

/** La línea del molde de respuesta que describe la clave `nuevos`. */
export const LINEA_MOLDE_NUEVOS = `  "${CLAVE_NUEVOS}": [{ "titulo": "…", "tipo": "párrafo", "contenido": "…" }]`;

/**
 * El trozo de prompt. Se pega DETRÁS de la lista de apartados del documento,
 * porque se lee como una excepción a esa lista y no como una invitación a
 * inventarse un índice nuevo.
 */
export const INSTRUCCION_NUEVOS = `APARTADOS NUEVOS (excepción, opcional): si en el material hay algo importante que NO cabe en ninguno de los apartados de arriba, añade la clave "${CLAVE_NUEVOS}" con un array de hasta ${MAX_NUEVOS} apartados que propongas tú:

  { "titulo": "Título corto en español", "tipo": "párrafo" | "lista", "contenido": "…" }   (en los de tipo lista, "contenido" es un array de líneas)

  · Solo si de verdad no cabe. Si el contenido encaja, aunque sea a medias, en un apartado de la lista de arriba, va ahí y NO propongas uno nuevo.
  · El título es el que se imprimirá en el documento: corto, en español, sin numerar y sin repetir el de un apartado que ya existe.
  · Nada de apartados vacíos ni "por si acaso": lo que propongas tiene que traer contenido dicho en el material.
  · Lo normal es no proponer ninguno. En ese caso devuelve "${CLAVE_NUEVOS}": [].`;

/**
 * "lista" o "texto" a partir de lo que conteste el modelo (al que se le pide
 * «párrafo» o «lista»). Todo lo que no sea claramente una lista es un párrafo:
 * un tipo inventado no puede dejar el apartado sin forma.
 */
function tipoDe(v) {
  const t = texto(v).toLowerCase();
  return t === "lista" || t === "list" || t === "bullets" ? "lista" : "texto";
}

/** El contenido de un apartado propuesto, ya en la forma que teclea la pantalla. */
function contenidoDe(bruto, tipo) {
  const v = bruto?.contenido ?? bruto?.texto ?? bruto?.valor ?? bruto?.content;
  if (Array.isArray(v)) {
    const lineas = v.map(texto).filter(Boolean);
    return tipo === "lista" ? lineas.join("\n") : lineas.join("\n\n");
  }
  return texto(v);
}

/**
 * Lo que ha propuesto el modelo → apartados listos para meter en el documento:
 * `[{ key, label, tipo, valor }]`.
 *
 * @param {object} parsed    El JSON ya parseado (lo hace `leerRespuesta`).
 * @param {Array}  bloques   Los apartados que YA tiene el documento: de ahí
 *                           salen las claves prohibidas.
 * @param {number} [max]     Tope de esta pasada (por defecto `MAX_NUEVOS`).
 */
export function apartadosPropuestos(parsed, bloques = [], { max = MAX_NUEVOS } = {}) {
  const bruto = parsed && typeof parsed === "object" ? parsed[CLAVE_NUEVOS] : null;
  if (!Array.isArray(bruto)) return [];
  // Las claves que no puede pedir: las del documento y las que se vayan
  // dando aquí mismo. Los títulos, en minúsculas, para no admitir dos veces
  // el mismo apartado con otra capitalización.
  // …y las reservadas de `contentSections` (`pruebas`, `apartados`,
  // `plantilla`…): un apartado propuesto que se llamara «Pruebas» pisaba el
  // bloque entero al guardar y su texto se perdía (revisión del 06/09/2026).
  const usadas = new Set([
    ...CLAVES_RESERVADAS,
    ...(Array.isArray(bloques) ? bloques : []).map((b) => texto(b?.key)).filter(Boolean),
  ]);
  const titulos = new Set(
    (Array.isArray(bloques) ? bloques : []).map((b) => texto(b?.label).toLowerCase()).filter(Boolean)
  );
  const salida = [];
  for (const crudo of bruto) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) continue;
    const label = texto(crudo.titulo ?? crudo.label ?? crudo.title).slice(0, 120);
    if (!label || titulos.has(label.toLowerCase())) continue;
    const tipo = tipoDe(crudo.tipo);
    const valor = contenidoDe(crudo, tipo);
    // Un apartado nuevo sin contenido es una casilla vacía más: no entra.
    if (!valor) continue;
    const base = slugApartado(label) || "apartado";
    let key = base;
    let n = 2;
    while (usadas.has(key)) key = `${base}_${n++}`.slice(0, 64);
    usadas.add(key);
    titulos.add(label.toLowerCase());
    salida.push({ key, label, tipo, valor });
    if (salida.length >= max) break;
  }
  return salida;
}

/**
 * Los apartados nuevos que de verdad caben en el documento, dado cuántos tiene
 * ya. El tope de `plantillas.js` (`MAX_APARTADOS`) manda: si el documento está
 * al borde, se aceptan los primeros y se dice cuántos se han quedado fuera.
 */
export function cabenNuevos(nuevos, cuantosHay, tope) {
  const lista = Array.isArray(nuevos) ? nuevos : [];
  const hueco = Math.max(0, tope - cuantosHay);
  return { entran: lista.slice(0, hueco), fuera: Math.max(0, lista.length - hueco) };
}
