/**
 * lib/billing/bajaProveedor.js — ¿el proveedor se borra o solo se da de baja?
 *
 * (Fichero nuevo en /lib, regla #2: la decisión vivía suelta dentro del DELETE
 * de `/api/proveedores/[id]`, pegada a los `count()`, y por eso nadie vio que
 * solo miraba una de las dos cosas que cuelgan de un proveedor. Sacada aquí se
 * puede probar sin base de datos: `scripts/_smoke-baja-proveedor.mjs`.)
 *
 * ── DE QUÉ FALLO REAL NACE (21/08/2026) ────────────────────────────────────
 *
 * Los usos se contaban solo en Gastos. Un proveedor del que solo hay mercancía
 * —ninguna factura de gasto— daba cero usos y se BORRABA de verdad. Y como
 * `StockEntry.supplierId` es un UUID **sin clave foránea**, Postgres no se
 * quejaba: las entradas se quedaban apuntando a un proveedor que ya no existe y
 * el histórico del almacén perdía de quién vino la mercancía. No era solo el
 * caso «inventario sin facturación»: con facturación pasaba igual en cuanto ese
 * proveedor no tuviera gastos.
 *
 * ── `null` NO ES `0` ───────────────────────────────────────────────────────
 *
 * Cada recuento se gatea por su módulo, así que hay tres estados y no dos:
 * un número (se ha mirado), `0` (se ha mirado y no hay nada) y `null` (ese
 * módulo no está, NO se ha mirado). Lo que no se ha mirado no se nombra en el
 * mensaje: decir «no tenía entradas de almacén» a quien no tiene Inventario
 * sería prometer una comprobación que nadie hizo.
 */

/**
 * Lo que cuelga de un proveedor, en el orden en que se nombra. El género es
 * para que concuerde «asociados» / «asociadas» en el mensaje.
 */
const FUENTES = [
  { clave: "gastos", singular: "gasto", plural: "gastos", femenino: false },
  {
    clave: "entradas",
    singular: "entrada de almacén",
    plural: "entradas de almacén",
    femenino: true,
  },
];

/** Un recuento que viene de un `count()`, o `null` si no se ha mirado. */
function cuenta(valor) {
  if (valor == null) return null;
  const n = Math.trunc(Number(valor));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** «a», «a y b», «a, b y c» — para no quedarse corto si algún día son tres. */
function enumerar(partes, union = "y") {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} ${union} ${partes[partes.length - 1]}`;
}

/**
 * Decide qué hacer con un proveedor al que se ha pedido dar de baja.
 *
 * Conservarlo es lo normal: sus gastos y sus entregas siguen apuntando aquí y
 * borrarlo dejaría el histórico sin nombre. Se borra de verdad solo cuando no
 * cuelga NADA de él, que es el caso del proveedor creado por error.
 *
 * @param {{ gastos?: number|null, entradas?: number|null }} recuentos usos por
 *   fuente; `null` (o ausente) = ese módulo no está y no se ha contado.
 * @returns {{ borrar: boolean, usos: number, desglose: { gastos: number|null,
 *   entradas: number|null }, mensaje: string }} `usos` es el total de lo que sí
 *   se ha mirado; `mensaje` dice DE QUÉ son, no un número pelado.
 */
export function decidirBajaProveedor({ gastos = null, entradas = null } = {}) {
  const desglose = { gastos: cuenta(gastos), entradas: cuenta(entradas) };
  const miradas = FUENTES.filter((f) => desglose[f.clave] != null);
  const conUsos = miradas.filter((f) => desglose[f.clave] > 0);
  const usos = conUsos.reduce((total, f) => total + desglose[f.clave], 0);

  if (usos === 0) {
    const nombres = miradas.map((f) => f.plural);
    const nada = nombres.length ? `: no tenía ${enumerar(nombres, "ni")}` : "";
    return { borrar: true, usos: 0, desglose, mensaje: `Eliminado${nada}` };
  }

  const partes = conUsos.map((f) => {
    const n = desglose[f.clave];
    return `${n} ${n === 1 ? f.singular : f.plural}`;
  });
  // Mezcla de géneros → masculino plural, que es lo que manda en castellano.
  const femenino = conUsos.every((f) => f.femenino);
  const asociados = `asociad${femenino ? "a" : "o"}${usos === 1 ? "" : "s"}`;
  const mensaje = `Dado de baja: tiene ${enumerar(partes)} ${asociados}`;
  return { borrar: false, usos, desglose, mensaje };
}
