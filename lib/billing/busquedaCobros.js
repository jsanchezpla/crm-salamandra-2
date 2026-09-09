/**
 * lib/billing/busquedaCobros.js — la búsqueda de Cobros, en el SERVIDOR
 * (31/08/2026).
 *
 * La pantalla cargaba 100 cobros y filtraba en el navegador: un cobro más
 * antiguo no aparecía por mucho que se buscara, sin aviso — el mismo agujero
 * ya arreglado en los selectores de fichas. Con ~175 cuotas al mes, muerde en
 * semanas.
 *
 * Mismas reglas que la búsqueda de siempre (lib/utils/busqueda.js), pero en
 * SQL: todas las palabras, cada una en cualquiera de los campos — la nota, el
 * nombre del cliente (directo o el de su factura), el nº de factura y el
 * método de pago en cristiano («tarjeta» encuentra method='card'). Y sin
 * exigir las tildes: se busca con regex y clases de vocales (`garcia` casa
 * «García», `nunez` casa «Núñez»), porque ILIKE es insensible a mayúsculas
 * pero no a acentos y aquí no hay extensión unaccent garantizada.
 */
import { Op } from "sequelize";

// El método de pago tal y como lo escribe la gente. Claves en minúscula y sin
// tildes (la palabra ya llega normalizada).
const METODO_DE_PALABRA = {
  tarjeta: "card",
  transferencia: "transfer",
  efectivo: "cash",
  domiciliacion: "direct_debit",
};

/** Una palabra → regex que ignora tildes y escapa lo especial. */
export function patronDePalabra(palabra) {
  return String(palabra)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[aá]/gi, "[aá]")
    .replace(/[eé]/gi, "[eé]")
    .replace(/[ií]/gi, "[ií]")
    .replace(/[oó]/gi, "[oó]")
    .replace(/[uúü]/gi, "[uúü]")
    .replace(/[nñ]/gi, "[nñ]");
}

/**
 * El fragmento `where` de la búsqueda, o `null` si no hay nada que buscar.
 * Necesita que la consulta lleve los includes `client` e `invoice` (con su
 * `client`) y `subQuery: false`, o las columnas `$...$` no existen.
 *
 * Con `conPaciente` también busca en el nombre y apellidos del paciente del
 * cobro (03/09/2026, Rodrigo: «el buscador de cobros tiene que buscar por
 * paciente para encontrar al cliente» — la familia que paga no siempre se
 * apellida como el niño). Solo si la consulta lleva el include `patient`:
 * la tabla de pacientes no existe en todos los tenants.
 */
export function whereDeBusquedaCobros(q, { conPaciente = false } = {}) {
  const palabras = String(q ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6); // nadie busca con más de seis palabras; un pegote enorme sí
  if (!palabras.length) return null;

  return {
    [Op.and]: palabras.map((p) => {
      const patron = patronDePalabra(p);
      const campos = [
        { notes: { [Op.iRegexp]: patron } },
        { "$client.name$": { [Op.iRegexp]: patron } },
        { "$invoice.number$": { [Op.iRegexp]: patron } },
        { "$invoice.client.name$": { [Op.iRegexp]: patron } },
      ];
      if (conPaciente) {
        // Con `$...$` Sequelize escribe la columna TAL CUAL: la de pacientes
        // va en snake_case (first_name), no como el atributo (firstName).
        campos.push({ "$patient.first_name$": { [Op.iRegexp]: patron } });
        campos.push({ "$patient.last_name$": { [Op.iRegexp]: patron } });
      }
      if (METODO_DE_PALABRA[p]) campos.push({ method: METODO_DE_PALABRA[p] });
      return { [Op.or]: campos };
    }),
  };
}

/**
 * Los mismos includes, pero SIN traer ninguna columna (09/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ──────────────────────────────────────────────────
 * Desde el 07/09/2026 la cabecera de Cobros suma los totales de TODO lo que
 * casa con el filtro y no solo de la página cargada. Para que la suma vea las
 * columnas `$client.name$` de la búsqueda, esa consulta repite los mismos
 * `include`. Pero los repetía con sus `attributes` puestos, y una consulta que
 * selecciona `SUM(amount)` y además `invoice.id`, `invoice.number`… sin GROUP
 * BY la rechaza PostgreSQL:
 *
 *     column "invoice.id" must appear in the GROUP BY clause… (42803)
 *
 * O sea que **buscar en Cobros devolvía un 500** —solo al buscar: sin texto no
 * hay JOIN que arrastre columnas—. Rosa lo contó como «no funciona el
 * buscador» el 09/09/2026, y es también el «Cobros dio error interno» que
 * estaba apuntado sin poder reproducirse.
 *
 * Para sumar, el JOIN solo hace falta como filtro: se conserva la asociación y
 * se le vacían los atributos, también los de los includes anidados (el
 * `client` que cuelga de `invoice`). Con `attributes: []` Sequelize monta el
 * JOIN y no selecciona nada suyo, así que la única columna del SELECT es la
 * agregada y no hace falta GROUP BY.
 *
 * @param {Array} includes  los mismos que lleva el listado
 * @returns {Array} copia; los de entrada no se tocan
 */
export function joinsSinColumnas(includes) {
  if (!Array.isArray(includes)) return [];
  return includes.map((inc) => ({
    ...inc,
    attributes: [],
    ...(Array.isArray(inc?.include) ? { include: joinsSinColumnas(inc.include) } : {}),
  }));
}
