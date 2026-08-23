/**
 * lib/billing/filtrosGasto.js — con qué filtros se pide la lista de gastos.
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón y mismo motivo que
 * lib/billing/camposGasto.js, una regla que comparten la tabla de Costes y su
 * botón de Excel.)
 *
 * QUÉ RESUELVE: la pantalla de Costes armaba la consulta DOS veces, una para
 * pintar la tabla y otra para el enlace del Excel, y las dos listas estaban
 * escritas a mano. `GET /api/billing/costs` y `GET /api/billing/exports/expenses`
 * aceptan los mismos ocho filtros; la pantalla mandaba cuatro a la tabla y los
 * mismos cuatro al Excel por casualidad, no porque nada lo garantizara. En una
 * pantalla de facturación esa deriva se paga cara: el Excel se baja sin quejarse
 * ignorando el filtro que el usuario está viendo aplicado, y quien lo abre cree
 * que está mirando lo mismo que la pantalla.
 *
 * Aquí NO se valida que los ids existan ni que las fechas sean fechas: eso lo
 * hace el endpoint contra la base.
 */

/**
 * Los filtros que entienden los dos endpoints de gastos, en el orden en que
 * viajan. Que la pantalla ofrezca todos o solo algunos es cosa suya: de aquí
 * sale únicamente lo que traiga valor.
 */
export const FILTROS_GASTO = [
  "type",
  "category",
  "supplierId",
  "employeeId",
  "partnerId",
  "clientId",
  "from",
  "to",
];

/** Un filtro sin elegir llega como `""` (o como `null`) y no debe viajar. */
function valorFiltro(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

/**
 * @param {object} filtros valores de los filtros, con las claves de FILTROS_GASTO
 * @param {object} [extras] lo que no es un filtro pero viaja igual (sortBy, sortDir)
 * @returns {URLSearchParams} solo con lo que tiene valor
 */
export function paramsFiltrosGasto(filtros = {}, extras = {}) {
  const params = new URLSearchParams();
  if (filtros && typeof filtros === "object") {
    for (const clave of FILTROS_GASTO) {
      const valor = valorFiltro(filtros[clave]);
      if (valor !== null) params.set(clave, valor);
    }
  }
  if (extras && typeof extras === "object") {
    for (const [clave, bruto] of Object.entries(extras)) {
      const valor = valorFiltro(bruto);
      if (valor !== null) params.set(clave, valor);
    }
  }
  return params;
}

/**
 * Pega los parámetros a la ruta sin dejar un «?» suelto cuando no hay ninguno.
 *
 * @param {string} ruta ruta del endpoint, sin query
 * @param {URLSearchParams} params
 * @returns {string}
 */
export function urlConFiltros(ruta, params) {
  const query = params?.toString() ?? "";
  return query ? `${ruta}?${query}` : ruta;
}
