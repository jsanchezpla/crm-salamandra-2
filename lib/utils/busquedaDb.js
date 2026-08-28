/**
 * lib/utils/busquedaDb.js — la mitad de la búsqueda que habla con la base
 * (28/08/2026).
 *
 * ── POR QUÉ ESTÁ PARTIDA EN DOS ────────────────────────────────────────────
 *
 * La regla —partir en palabras, exigirlas todas, sin tildes— es la misma se
 * resuelva donde se resuelva, y hace falta en las dos orillas: en el servidor
 * cuando la lista viene de una consulta, y en el NAVEGADOR cuando la lista ya
 * está descargada y se filtra encima (los desplegables con buscador, las
 * pantallas de Facturación…).
 *
 * Por eso `lib/utils/busqueda.js` no importa NADA: así un componente de cliente
 * puede usarla sin arrastrar Sequelize al paquete del navegador. Todo lo que
 * necesita Sequelize vive aquí. Es el mismo reparto que `lib/auth/contrasena.js`
 * (pura) y `lib/auth/correoCuentaDb.js`, y por el mismo motivo.
 *
 * Nació junta y se partió el mismo día, al ir a usarla en `components/ui/`.
 */

import { Op, fn, col, where as sqlWhere } from "sequelize";
import { palabrasDe, escaparLike } from "./busqueda.js";

// ¿Tiene esta base la extensión `unaccent`? Se mira UNA vez por instancia de
// Sequelize (una por cliente) y se recuerda: preguntar a `pg_extension` en cada
// búsqueda sería una consulta de más por tecla pulsada.
//
// Vivía en `lib/nutricion/foods.js`, que era su primer usuario. Se mudó aquí
// porque ahora la usan Pacientes, Formación y media docena de listados más, y
// que una pieza transversal viva dentro de un módulo obliga al resto del CRM a
// depender de Nutrición para buscar. `foods.js` la sigue exportando para no
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
 * ⚠️ DOS AVISOS, y los dos han costado un rato:
 *
 * 1. Se devuelve para meter en `Op.and`, NUNCA para asignar a `where[Op.or]`.
 *    Dos `Op.or` en el mismo objeto se pisan y el segundo se lleva por delante
 *    al primero EN SILENCIO.
 *
 * 2. Las columnas van con su nombre de BASE DE DATOS y cualificadas con un
 *    alias, porque `col()` escribe lo que le des tal cual en el SQL. Y el alias
 *    depende de DÓNDE viaje la cláusula:
 *      · en el `where` del modelo raíz → el alias del MODELO:  "Client.name"
 *      · dentro del `where` de un include → el de la ASOCIACIÓN: "trainingUser.name"
 *    Equivocarse no da un resultado raro: da un 500 («falta una entrada para la
 *    tabla en la cláusula FROM»).
 */
export function condicionPorPalabras(texto, columnas, { unaccent = false } = {}) {
  const palabras = palabrasDe(texto);
  if (palabras.length === 0) return null;
  if (!Array.isArray(columnas) || columnas.length === 0) return null;
  return { [Op.and]: palabras.map((p) => palabraEnAlguna(p, columnas, unaccent)) };
}

/**
 * Lo mismo, pero mirando antes si la base admite tildes. Es lo que llaman los
 * endpoints: una línea en vez de tres.
 */
export async function filtroPorNombre(sequelize, texto, columnas) {
  if (palabrasDe(texto).length === 0) return null;
  const unaccent = await hasUnaccentSupport(sequelize);
  return condicionPorPalabras(texto, columnas, { unaccent });
}
