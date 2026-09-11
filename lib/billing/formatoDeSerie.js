/**
 * lib/billing/formatoDeSerie.js — cómo se escribe el número de una serie.
 *
 * (12/09/2026, Rodrigo: «saca las facturas de Organízate que falten y sigue
 * su numeración para crear las nuevas y las rectificativas».)
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Aumenta factura desde 2022 en Organízate con números como `C2602245` (C,
 * el año en dos cifras y cinco dígitos) y rectificativas como `R-C2600028`.
 * El CRM tenía UN formato clavado en el código, `F-2026-0001`, y el día que
 * el centro emitió aquí sus tres primeras facturas salieron con esa
 * numeración, distinta de la de las 14.274 que ya tenían. Las anularon ellos
 * mismos el 09/09 con la nota «SE ANULA PORQUE NO PUEDE HABER NUMERACIONES
 * DISTINTAS», y tenían razón: una serie es una sola cuenta correlativa, y
 * cambiar de programa no da derecho a empezar otra.
 *
 * ── QUÉ ES ESTA PIEZA ──────────────────────────────────────────────────────
 * La serie guarda su formato (`invoice_series.number_format`) y aquí vive lo
 * único que hay que saber de él: cómo se escribe un número, cómo se reconocen
 * los que ya existen de esa serie y ese año, y qué correlativo llevan dentro.
 * Sin formato guardado se escribe como siempre, `{prefix}-{year}-{n:4}`, así
 * que los demás clientes no notan nada.
 *
 * Fichas del formato (y nada más):
 *   {prefix}  el prefijo de la serie          {year}  el año con cuatro cifras
 *   {yy}      el año con dos cifras           {n}     el correlativo; `{n:5}`
 *                                                     lo rellena con ceros a 5
 * Tiene que llevar `{n}` exactamente una vez. `{prefix}{yy}{n:5}` con prefijo
 * `C` escribe `C2602246`; con prefijo `R-C`, `R-C2600029`.
 *
 * Los números que ya existen se reconocen con una expresión regular hecha del
 * mismo formato (`^C26([0-9]{5,})$`), no con un LIKE: el correlativo hay que
 * EXTRAERLO, y en `C2602245` los dígitos del año y los del número van pegados,
 * así que «los dígitos del final» no sirve. La misma expresión vale en
 * Postgres (`~`): solo lleva `[0-9]`, llaves de repetición, anclas y
 * literales escapados.
 */

export const FORMATO_POR_DEFECTO = "{prefix}-{year}-{n:4}";
export const LARGO_MAXIMO_FORMATO = 40;

const FICHA_RE = /\{(prefix|year|yy|n(?::(\d{1,2}))?)\}/g;

const texto = (v) => String(v ?? "").trim();

/** Las fichas de un formato, en orden, con el texto literal que hay entre ellas. */
function trozos(formato) {
  const partes = [];
  let ultimo = 0;
  for (const m of String(formato).matchAll(FICHA_RE)) {
    if (m.index > ultimo) partes.push({ literal: formato.slice(ultimo, m.index) });
    const ficha = m[1].startsWith("n") ? "n" : m[1];
    partes.push({ ficha, relleno: ficha === "n" ? Number(m[2] ?? 0) : 0 });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < formato.length) partes.push({ literal: formato.slice(ultimo) });
  return partes;
}

/** ¿Se puede guardar este formato? Solo fichas conocidas, una sola `{n}` y ninguna llave suelta. */
export function esFormatoValido(formato) {
  const f = texto(formato);
  if (!f || f.length > LARGO_MAXIMO_FORMATO) return false;
  if (/[{}]/.test(f.replace(FICHA_RE, ""))) return false;
  return trozos(f).filter((p) => p.ficha === "n").length === 1;
}

/** El formato con el que escribe una serie: el guardado si vale, y si no el de siempre. */
export function formatoDeSerie(serie) {
  const guardado = texto(serie?.numberFormat ?? serie?.number_format);
  return esFormatoValido(guardado) ? guardado : FORMATO_POR_DEFECTO;
}

const prefijoDe = (serie) => texto(serie?.prefix) || texto(serie?.code) || "F";

const valorDe = (parte, { prefix, year, n }) => {
  if (parte.literal !== undefined) return parte.literal;
  if (parte.ficha === "prefix") return prefix;
  if (parte.ficha === "year") return String(year);
  if (parte.ficha === "yy") return String(year).slice(-2);
  return String(n).padStart(parte.relleno, "0");
};

/** El número que escribe una serie para el año `year` y el correlativo `n`. */
export function numeroDeSerie(serie, { year, n }) {
  const prefix = prefijoDe(serie);
  return trozos(formatoDeSerie(serie))
    .map((p) => valorDe(p, { prefix, year, n }))
    .join("");
}

const escapaRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * La expresión regular que reconoce los números de una serie en un año, con
 * el correlativo en el primer grupo. `regexDeSerie(serie, año).source` es lo
 * que se le pasa a Postgres.
 */
export function regexDeSerie(serie, year) {
  const prefix = prefijoDe(serie);
  const cuerpo = trozos(formatoDeSerie(serie))
    .map((p) =>
      p.ficha === "n" ? `([0-9]{${Math.max(1, p.relleno)},})` : escapaRegex(valorDe(p, { prefix, year, n: 0 }))
    )
    .join("");
  return new RegExp(`^${cuerpo}$`);
}

/** El correlativo que lleva dentro un número de esa serie y año, o null si no es de ella. */
export function correlativoDe(serie, year, number) {
  const m = regexDeSerie(serie, year).exec(texto(number));
  return m ? Number(m[1]) : null;
}

/** Cómo quedaría el próximo número de la serie tal y como está hoy, para enseñarlo en Configuración. */
export function ejemploDeSerie(serie) {
  const year = Number(serie?.year) || new Date().getFullYear();
  const n = Number(serie?.nextNumber ?? serie?.next_number);
  return numeroDeSerie(serie, { year, n: Number.isFinite(n) && n > 0 ? n : 1 });
}
