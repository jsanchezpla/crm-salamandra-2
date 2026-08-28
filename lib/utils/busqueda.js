/**
 * lib/utils/busqueda.js — buscar a una persona escribiendo su nombre COMPLETO
 * (28/08/2026, Jorge: «al buscar en Clínica → Pacientes sí sale cuando pongo el
 * nombre, pero con los apellidos no sale»).
 *
 * ── QUÉ ESTABA ROTO Y POR QUÉ NADIE LO VIO ─────────────────────────────────
 *
 * El nombre de un paciente vive PARTIDO en dos columnas: `first_name` es
 * «Hugo» y `last_name` es «Castro Díaz». El buscador hacía esto:
 *
 *     where[Op.or] = [{ firstName: { [Op.iLike]: `%${q}%` } },
 *                     { lastName:  { [Op.iLike]: `%${q}%` } }];
 *
 * o sea: buscaba la frase ENTERA dentro de CADA columna por separado. Con
 * «hugo» funciona, porque «hugo» sí está entero dentro de `first_name`. Con
 * «hugo castro» no puede funcionar nunca: esa cadena no está entera en
 * `first_name` («Hugo») ni en `last_name` («Castro Díaz»). No hay ningún
 * paciente al que le funcione, y por eso pasó desapercibido: quien probó
 * escribió un nombre suelto.
 *
 * Medido en producción el 28/08/2026, antes de tocar nada: de los 1.174
 * pacientes de Aumenta, **1.174** eran imposibles de encontrar escribiendo su
 * propio nombre y su primer apellido. El 100%. Y 1.080 tienen dos apellidos,
 * que es justo cuando a una persona le sale solo teclear los dos.
 *
 * ── LO QUE HACE AHORA ──────────────────────────────────────────────────────
 *
 * Parte lo escrito en PALABRAS y exige que estén TODAS, cada una en cualquiera
 * de las columnas. «hugo castro» pide «hugo» en algún sitio Y «castro» en algún
 * sitio: da igual el orden, da igual que uno sea el nombre y otro el apellido,
 * y da igual saltarse el apellido de en medio («hugo díaz» encuentra a «Hugo
 * Castro Díaz»). Que es como busca cualquiera.
 *
 * Y sin tildes, porque si no el arreglo se quedaría a medias: 671 de los 1.174
 * pacientes de Aumenta llevan tilde o eñe en el nombre, así que quien escriba
 * «diaz» seguiría sin encontrar a «Díaz». Eso lo resuelve `unaccent` de
 * Postgres, que YA está instalada en local y en producción y que el buscador de
 * alimentos ya usaba (`app/api/nutricion/foods/route.js`). Si algún día una
 * base no la tuviera, se cae solo a `lower()` sin tildes: se pierde el acento,
 * no la búsqueda.
 *
 * ── POR QUÉ LAS COLUMNAS SE PIDEN CON SU NOMBRE DE BASE DE DATOS ───────────
 *
 * Las condiciones se construyen con `fn`/`col` de Sequelize, no con la forma
 * `{ atributo: { [Op.iLike]: … } }`, porque hay que envolver la columna en
 * `unaccent(lower(...))`. `col()` escribe el nombre tal cual en el SQL, así que
 * aquí se pasa `"Patient.first_name"` (columna real, con el alias del modelo
 * por delante) y no `"firstName"`. El alias importa: en cuanto la consulta
 * lleva un `include`, una columna sin cualificar que exista en las dos tablas
 * sale como ambigua y revienta con un 500.
 */

import { Op, fn, col, where as sqlWhere } from "sequelize";

// Un nombre completo español rara vez pasa de 5 palabras («maría del carmen
// garcía lópez»). El tope está para que nadie mande 400 palabras y monte 400
// condiciones: es un freno de recursos, no una regla de negocio.
export const MAX_PALABRAS = 8;
const MAX_LARGO_PALABRA = 60;

/**
 * Parte lo que ha escrito una persona en palabras buscables.
 *
 *   palabrasDe("  Hugo   CASTRO ") → ["hugo", "castro"]
 *
 * Va en minúsculas porque la comparación se hace contra `lower(columna)`. Las
 * tildes NO se quitan aquí: de eso se encarga Postgres con `unaccent`, que es
 * quien tiene que ver los dos lados iguales.
 */
export function palabrasDe(texto) {
  if (typeof texto !== "string") return [];
  return texto
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.slice(0, MAX_LARGO_PALABRA))
    .slice(0, MAX_PALABRAS);
}

/**
 * Escapa los comodines de LIKE. Sin esto, quien escriba `%` en el buscador se
 * lleva la lista entera y quien escriba `_` casa con cualquier letra: no es un
 * agujero de seguridad (Sequelize sigue parametrizando el valor), pero sí un
 * resultado que no se entiende. La barra invertida es el escape por defecto de
 * LIKE en Postgres, así que no hace falta cláusula ESCAPE.
 */
export function escaparLike(palabra) {
  return String(palabra).replace(/[\\%_]/g, "\\$&");
}

// ¿Tiene esta base la extensión `unaccent`? Se mira UNA vez por instancia de
// Sequelize (una por cliente) y se recuerda: preguntar a `pg_extension` en cada
// búsqueda sería una consulta de más por tecla pulsada.
//
// Vivía en `lib/nutricion/foods.js`, que era su primer usuario. Se ha mudado
// aquí porque ahora la usan Pacientes y el catálogo de alimentos, y que una
// pieza transversal viva dentro de un módulo obliga a que el resto del CRM
// dependa de Nutrición para buscar. `foods.js` la sigue exportando para no
// tocar a quien ya la importaba de allí.
const _cacheUnaccent = new WeakMap();

export async function hasUnaccentSupport(sequelize) {
  if (!sequelize) return false;
  if (_cacheUnaccent.has(sequelize)) return _cacheUnaccent.get(sequelize);
  try {
    const [rows] = await sequelize.query(
      "SELECT 1 AS ok FROM pg_extension WHERE extname = 'unaccent' LIMIT 1"
    );
    const has = Array.isArray(rows) && rows.length > 0;
    _cacheUnaccent.set(sequelize, has);
    return has;
  } catch {
    // Si la detección falla, se da por NO disponible: se pierde la tolerancia a
    // tildes, pero la búsqueda sigue funcionando. El lado seguro del error.
    _cacheUnaccent.set(sequelize, false);
    return false;
  }
}

/**
 * La condición de una sola palabra: que aparezca en CUALQUIERA de las columnas.
 */
function palabraEnAlguna(palabra, columnas, unaccent) {
  const patron = `%${escaparLike(palabra)}%`;
  return {
    [Op.or]: columnas.map((columna) =>
      unaccent
        ? sqlWhere(fn("unaccent", fn("lower", col(columna))), { [Op.like]: fn("unaccent", patron) })
        : sqlWhere(fn("lower", col(columna)), { [Op.like]: patron })
    ),
  };
}

/**
 * La cláusula de búsqueda: TODAS las palabras, cada una en CUALQUIERA de las
 * columnas. Devuelve `null` cuando no hay nada que buscar, para que quien la
 * llama pueda no añadir nada al `where`.
 *
 *   const filtro = condicionPorPalabras("hugo castro",
 *                                       ["Patient.first_name", "Patient.last_name"],
 *                                       { unaccent: true });
 *   if (filtro) (where[Op.and] ||= []).push(filtro);
 *
 * ⚠️ Se devuelve para meter en `Op.and`, NUNCA para asignar a `where[Op.or]`.
 * Dos `Op.or` en el mismo objeto se pisan y el segundo se lleva por delante al
 * primero EN SILENCIO — es el mismo tropiezo que ya está avisado en el filtro
 * por terapeuta de `app/api/pacientes/route.js`.
 */
export function condicionPorPalabras(texto, columnas, { unaccent = false } = {}) {
  const palabras = palabrasDe(texto);
  if (palabras.length === 0) return null;
  if (!Array.isArray(columnas) || columnas.length === 0) return null;
  return { [Op.and]: palabras.map((p) => palabraEnAlguna(p, columnas, unaccent)) };
}

/**
 * Lo mismo, pero mirando solo si la base admite tildes. Es lo que llaman los
 * endpoints: una línea en vez de tres.
 */
export async function filtroPorNombre(sequelize, texto, columnas) {
  if (palabrasDe(texto).length === 0) return null;
  const unaccent = await hasUnaccentSupport(sequelize);
  return condicionPorPalabras(texto, columnas, { unaccent });
}

/**
 * La versión de andar por casa, para filtrar en el navegador una lista que ya
 * está descargada. Misma regla —todas las palabras, en cualquier campo— para
 * que buscar signifique lo mismo en las dos orillas.
 *
 *   coincidePorNombre("hugo castro", ["Hugo", "Castro Díaz"]) → true
 */
export function coincidePorNombre(texto, campos) {
  const palabras = palabrasDe(texto);
  if (palabras.length === 0) return true;
  const heno = (Array.isArray(campos) ? campos : [campos])
    .filter((c) => c != null && c !== "")
    .map((c) => sinTildes(String(c).toLowerCase()));
  if (heno.length === 0) return false;
  return palabras.every((p) => {
    const aguja = sinTildes(p);
    return heno.some((c) => c.includes(aguja));
  });
}

/**
 * Quita tildes en JavaScript, para el filtrado del navegador. Descomponer en
 * NFD y tirar los signos combinantes ya convierte la eñe en ene («Muñoz» →
 * «Munoz»), que es exactamente lo que hace `unaccent` en Postgres: las dos
 * orillas tienen que normalizar IGUAL, o la misma búsqueda daría resultados
 * distintos según quién la resuelva.
 */
export function sinTildes(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
