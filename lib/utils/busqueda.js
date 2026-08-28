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
 * ── ESTE FICHERO NO IMPORTA NADA, Y ES A PROPÓSITO ─────────────────────────
 *
 * La misma regla hace falta en las dos orillas: en el SERVIDOR, cuando la
 * lista sale de una consulta, y en el NAVEGADOR, cuando la lista ya está
 * descargada y se filtra encima (los desplegables con buscador, las pantallas
 * de Facturación…). Si buscar significara una cosa en cada sitio, la misma
 * palabra daría resultados distintos según quién la resolviera.
 *
 * Por eso aquí no hay un solo `import`: un componente de cliente puede usar
 * `coincidePorNombre` sin arrastrar Sequelize al paquete del navegador. Todo
 * lo que necesita Sequelize está en `busquedaDb.js` — `filtroPorNombre` es lo
 * que llaman los endpoints. Mismo reparto que `lib/auth/contrasena.js`.
 */

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

// Lo que necesita Sequelize —detectar `unaccent` y montar la cláusula del
// WHERE— vive en `busquedaDb.js`, al lado. Este fichero NO importa nada a
// propósito: así puede usarlo un componente de cliente sin arrastrar Sequelize
// al paquete del navegador. Mismo reparto que `lib/auth/contrasena.js`.
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
