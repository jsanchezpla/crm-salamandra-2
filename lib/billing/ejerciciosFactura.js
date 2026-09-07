/**
 * lib/billing/ejerciciosFactura.js — las facturas de una familia, por ejercicio
 * (07/09/2026, AV-0066 de Aumenta).
 *
 * Rosa: «en el apartado de CLIENTES (facturación) no se ven todas las facturas
 * emitidas de ese paciente en ejercicios anteriores y no se pueden descargar».
 * Y era literal: la pestaña pintaba `invoices.slice(0, 10)` sobre una lista que
 * el servidor ya había recortado, ordenada de la más nueva a la más vieja, así
 * que a una familia con historia se le veía el año en curso y nada más. En
 * Aumenta eso escondía 8.420 de las 14.246 facturas vivas, y hay 12.135
 * anteriores a 2026 (2022: 1.084 · 2023: 3.926 · 2024: 3.943 · 2025: 3.182).
 *
 * Aquí solo vive el reparto por año, que es lo que la pantalla necesita para
 * ofrecer «2024» y que se pueda ir a buscar una factura vieja. Es puro y no
 * toca la base: lo importa un componente de navegador, así que no puede
 * arrastrar Sequelize.
 *
 * El ejercicio se saca del texto de `issueDate` («2024-03-11») y NO con `new
 * Date`: una fecha sin hora se interpreta como UTC y en Madrid una factura del
 * 1 de enero se iría al año anterior.
 */

/** El año de una factura, o null si no tiene fecha legible. */
export function ejercicioDe(factura) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(factura?.issueDate ?? ""));
  return m ? m[1] : null;
}

/** Los ejercicios que tiene esa familia, del más nuevo al más viejo. */
export function ejerciciosDe(facturas = []) {
  const años = new Set();
  for (const f of facturas) {
    const a = ejercicioDe(f);
    if (a) años.add(a);
  }
  return [...años].sort().reverse();
}

/**
 * Las facturas de un ejercicio. Sin ejercicio elegido (`""` o null) devuelve
 * todas: «todos los años» es una opción de la lista, no una ausencia de filtro
 * que haya que tratar aparte en la pantalla.
 */
export function facturasDelEjercicio(facturas = [], ejercicio) {
  if (!ejercicio) return [...facturas];
  return facturas.filter((f) => ejercicioDe(f) === String(ejercicio));
}

/**
 * ¿Se puede descargar el PDF de esa factura? Un borrador todavía no es
 * documento: no tiene número y el PDF saldría sin él. Misma regla que la lista
 * de Facturas, para que la ficha no ofrezca lo que la otra pantalla esconde.
 */
export function sePuedeDescargar(factura) {
  return Boolean(factura?.id) && factura?.status !== "draft";
}
