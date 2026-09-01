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
 */
export function whereDeBusquedaCobros(q) {
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
      if (METODO_DE_PALABRA[p]) campos.push({ method: METODO_DE_PALABRA[p] });
      return { [Op.or]: campos };
    }),
  };
}
