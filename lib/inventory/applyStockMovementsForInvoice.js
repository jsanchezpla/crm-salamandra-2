/**
 * applyStockMovementsForInvoice — AVISA, ya no descuenta (02/08/2026).
 *
 * ── Qué hacía antes y por qué ha cambiado ──────────────────────────────────
 *
 * Descontaba stock al EMITIR una factura, resolviendo la receta del producto
 * (`Formula`) y bajando kilos FIFO de los lotes (`InboundBatch`). Con el rework
 * de Inventario esos tres modelos ya no existen, así que este fichero era código
 * muerto que habría reventado la emisión de facturas en cuanto alguien pulsara
 * «Emitir» en un tenant con almacén.
 *
 * Pero además tenía un problema de fondo, y es el motivo de no reescribirlo tal
 * cual: **habría descontado dos veces**. Completar un pedido ya descuenta stock
 * Y genera su factura en borrador; si al emitir esa factura se descontara otra
 * vez, cada venta hecha por el camino normal restaría el doble.
 *
 * ── La regla, en una línea ─────────────────────────────────────────────────
 *
 *   El stock se mueve en PEDIDOS. La factura es un documento contable, no un
 *   movimiento de almacén.
 *
 * Lo que sí hace ahora es **avisar** cuando una factura lleva productos del
 * almacén y NO viene de un pedido: en ese caso nadie ha tocado el stock, y es
 * mejor decirlo que dejar que el almacén se desvíe en silencio. No bloquea la
 * emisión: una factura no puede quedarse sin emitir por un asunto de almacén.
 *
 * @returns Array<string> con avisos (vacío si no hay nada que decir).
 */
export async function applyStockMovementsForInvoice({ invoice }) {
  const avisos = [];

  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const conProducto = lines.filter((l) => l.productId && l.kind !== "shipping");
  if (conProducto.length === 0) return avisos;

  // Las facturas que nacen al completar un pedido llevan su id aquí. Ese pedido
  // ya generó los movimientos de salida, así que no hay nada que avisar.
  const vieneDePedido = !!invoice.customFields?.sourceOrderId;
  if (vieneDePedido) return avisos;

  avisos.push(
    conProducto.length === 1
      ? "Esta factura incluye un producto del almacén, pero no viene de un pedido: el stock NO se ha descontado. Hazlo desde Pedidos o con un ajuste manual."
      : `Esta factura incluye ${conProducto.length} productos del almacén, pero no viene de un pedido: el stock NO se ha descontado. Hazlo desde Pedidos o con un ajuste manual.`
  );

  return avisos;
}
