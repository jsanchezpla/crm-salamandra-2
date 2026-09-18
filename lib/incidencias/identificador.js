/**
 * lib/incidencias/identificador.js — con qué se llama a un caso.
 *
 * (Fichero nuevo en /lib, regla #2: lo necesitan `scripts/buzon-triaje.mjs`
 * —que hasta hoy llevaba su propio `comoBuscarlo` sin una sola prueba—, el
 * endpoint del tablero y la prueba que fija las reglas. Tres copias de «qué es
 * esto que me han escrito» acaban siendo tres respuestas distintas para la
 * misma cadena.)
 *
 * ── NO SE INVENTA NINGÚN IDENTIFICADOR NUEVO ────────────────────────────────
 * Ya había dos y cada uno sirve para lo suyo:
 *
 *   · `AV-0169` — el correlativo del Buzón (`master.buzon_numero_seq`), lo que
 *     el cliente nos dice por teléfono. Se formatea con `referencia()` de
 *     `lib/buzon/buzon.js`; NO está guardado en ninguna columna, se deriva de
 *     `numero`.
 *   · `s55hv5` — la ficha de la tarea del Registro (`lib/tablero/editor.js`
 *     `nuevaFicha`), seis caracteres de un alfabeto sin `l`, `o`, `0` ni `1`
 *     para poder leerla en voz alta. Sobrevive a que se reescriba el título, y
 *     es lo que guarda `BuzonAviso.registroFicha`.
 *
 * Esto solo dice CUÁL de los dos te han dado. Sin base de datos, a propósito,
 * para que `scripts/_smoke-incidencia-identificador.mjs` corra sin Postgres.
 *
 * ⚠️ EL ORDEN DE LAS REGLAS NO ES COSMÉTICO. `ES_FICHA` es `[a-z0-9]{4,32}`, o
 * sea que «av0169» —la forma en que se teclea una referencia cuando se dicta por
 * teléfono, sin guion— también casa con ella. Si se probara la ficha primero,
 * `av0169` se buscaría como ficha del tablero, no encontraría nada y el caso
 * saldría «no existe» teniendo el aviso delante. Por eso el AV va SIEMPRE antes.
 */

/** Un UUID de los nuestros. */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `AV-0169`, `AV0169`, `av 169`. El guion y los ceros de delante dan igual. */
const ES_AVISO = /^av[\s-]?(\d{1,9})$/i;

/** La ficha, tal como la acepta el parser del tablero (`ES_FICHA`). */
const ES_FICHA = /^[a-z0-9]{4,32}$/;

/**
 * Qué te han dado.
 *
 * @returns {{tipo:"aviso",numero:number}
 *         | {tipo:"avisoId",id:string}
 *         | {tipo:"ficha",ficha:string}
 *         | {tipo:"texto",texto:string}}
 *
 * `texto` es el final honesto: no casa con ninguna de las tres formas, así que
 * quien llame decide si lo busca por título o se para y pregunta. Devolver una
 * ficha inventada sería peor que no reconocerlo.
 */
export function interpretar(entrada) {
  const ref = String(entrada ?? "").trim();
  if (!ref) return { tipo: "texto", texto: "" };

  const aviso = ES_AVISO.exec(ref);
  // `Number` se come los ceros de delante: «AV-0007» y «AV-7» son el mismo.
  if (aviso) return { tipo: "aviso", numero: Number(aviso[1]) };

  if (ES_UUID.test(ref)) return { tipo: "avisoId", id: ref };

  // La ficha se guarda y se escribe en minúsculas (`marcaDeFicha`), así que una
  // dictada a gritos —«S55HV5»— tiene que valer igual.
  const enMinusculas = ref.toLowerCase();
  if (ES_FICHA.test(enMinusculas)) return { tipo: "ficha", ficha: enMinusculas };

  return { tipo: "texto", texto: ref };
}

/**
 * Lo mismo, con la forma que pide un `where` de Sequelize sobre `BuzonAviso`.
 * `null` si lo que hay no identifica un aviso (una ficha identifica la TAREA,
 * y el aviso se busca entonces por `registroFicha`).
 */
export function comoBuscarElAviso(entrada) {
  const q = interpretar(entrada);
  if (q.tipo === "aviso") return { numero: q.numero };
  if (q.tipo === "avisoId") return { id: q.id };
  if (q.tipo === "ficha") return { registroFicha: q.ficha };
  return null;
}
