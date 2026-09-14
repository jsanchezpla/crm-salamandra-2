/**
 * lib/billing/tipoDeFactura.js — facturas normales o rectificativas, y en qué
 * orden salen al ordenar por número (14/09/2026, Rodrigo para Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * «Cuando las agrupas por número se ponen primero las rectificativas». El
 * número se ordenaba como texto a secas y el primer clic en «Nº» es de mayor a
 * menor: `R-C2600029` va detrás de `C2602282` en el abecedario, así que las 29
 * rectificativas del año tapaban la primera página entera.
 *
 * Y la otra mitad del encargo: «botón de mirar facturas rectificativas o mirar
 * facturas normales». La lista las mezclaba sin forma de separarlas.
 *
 * ── QUÉ ES UNA RECTIFICATIVA ───────────────────────────────────────────────
 * La que está en una serie de tipo `rectificative` O la que apunta a otra
 * (`rectifiesInvoiceId`). Las dos cosas, porque ninguna basta sola: las 29 que
 * llegaron de Organízate están en la serie R pero NO apuntan a su original
 * (allí no se sabía), y una rectificativa hecha en el CRM lo cumple todo. Se
 * mira el TIPO de la serie y no la letra «R»: el código lo elige cada centro.
 *
 * Puro: sin base de datos. Prueba en `scripts/_smoke-tipo-de-factura.mjs`.
 */

export const TIPOS_DE_FACTURA = ["normales", "rectificativas", "todas"];

/** Lo que llega de la barra de direcciones; lo desconocido es «todas». */
export function tipoDeFacturaValido(valor) {
  return TIPOS_DE_FACTURA.includes(valor) ? valor : "todas";
}

/** Los códigos de las series rectificativas, a partir de las filas de `invoice_series`. */
export function codigosRectificativos(series = []) {
  const codigos = (Array.isArray(series) ? series : [])
    .filter((s) => s?.kind === "rectificative" && s?.code)
    .map((s) => String(s.code));
  // Sin series dadas de alta sigue valiendo la R de fábrica.
  return codigos.length ? [...new Set(codigos)] : ["R"];
}

/**
 * El trozo de `where` para un tipo. `null` cuando no hay que filtrar.
 *
 * @param {object} args
 * @param {string} args.tipo       "normales" | "rectificativas" | "todas"
 * @param {string[]} args.codigos  los de `codigosRectificativos`
 * @param {object} args.Op         los operadores de Sequelize
 */
export function whereTipoDeFactura({ tipo, codigos, Op }) {
  const t = tipoDeFacturaValido(tipo);
  if (t === "todas") return null;
  if (t === "rectificativas") {
    return { [Op.or]: [{ series: { [Op.in]: codigos } }, { rectifiesInvoiceId: { [Op.ne]: null } }] };
  }
  return { series: { [Op.notIn]: codigos }, rectifiesInvoiceId: null };
}

/** ¿Esta factura es rectificativa? La misma regla que el `where`, en memoria. */
export function esRectificativa(factura, codigos = ["R"]) {
  if (!factura) return false;
  return codigos.includes(String(factura.series ?? "")) || Boolean(factura.rectifiesInvoiceId);
}

/**
 * El `order` de ordenar por número: primero las normales y DESPUÉS las
 * rectificativas, en los dos sentidos, y dentro de cada grupo por número.
 * Así «Todas» ordenada por número no vuelve a abrir con las R.
 *
 * `literal` es `sequelize.literal` y `escape` es `sequelize.escape`: los códigos
 * vienen de la base, pero van dentro de SQL y se escapan igual.
 */
export function ordenPorNumero({ dir, codigos, literal, escape }) {
  const sentido = String(dir).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const lista = codigos.map((c) => escape(c)).join(", ");
  const grupo = literal(
    `CASE WHEN "Invoice"."series" IN (${lista}) OR "Invoice"."rectifies_invoice_id" IS NOT NULL THEN 1 ELSE 0 END`,
  );
  return [[grupo, "ASC"], ["number", sentido]];
}
