/**
 * stock — el stock de un producto es la SUMA de sus movimientos.
 *
 * (Fichero nuevo en /lib, regla #2: lo consultan la lista de productos, la ficha,
 * el alta de entradas y —lo importante— Pedidos al descontar. Si cada uno lo
 * calculara por su cuenta acabarían dando cifras distintas, que es justo lo que
 * pasa cuando se guarda el stock en una columna.)
 *
 * No hay ninguna columna «stock actual» y es deliberado: una columna
 * denormalizada se desincroniza en cuanto una operación falla a medias, y desde
 * ese momento nadie sabe cuál de los dos números es la verdad. Sumar filas
 * indexadas por producto es barato.
 */

import { Op, fn, col } from "sequelize";

/** Stock de UN producto. */
export async function stockDe(tenantModels, productId) {
  const { StockMovement } = tenantModels;
  const total = await StockMovement.sum("quantity", { where: { productId } });
  return Number(total ?? 0);
}

/**
 * Stock de MUCHOS productos de una vez: `{ [productId]: cantidad }`.
 *
 * Existe para que la lista de productos no haga una consulta por fila (el
 * clásico N+1 que convierte una pantalla de 200 productos en 200 consultas).
 */
export async function stockDeVarios(tenantModels, productIds = []) {
  const { StockMovement } = tenantModels;
  if (!productIds.length) return {};
  const filas = await StockMovement.findAll({
    attributes: ["productId", [fn("SUM", col("quantity")), "total"]],
    where: { productId: { [Op.in]: productIds } },
    group: ["product_id"],
    raw: true,
  });
  const salida = {};
  for (const id of productIds) salida[id] = 0;
  for (const f of filas) salida[f.productId] = Number(f.total ?? 0);
  return salida;
}

/**
 * Productos por debajo de su mínimo. Los que no tienen `minStock` no cuentan:
 * no haber puesto un mínimo no es estar bajo mínimos.
 */
export async function bajoMinimo(tenantModels) {
  const { Product } = tenantModels;
  const productos = await Product.findAll({
    where: { active: true, minStock: { [Op.ne]: null } },
    attributes: ["id", "name", "unit", "minStock"],
  });
  if (!productos.length) return [];
  const stocks = await stockDeVarios(tenantModels, productos.map((p) => p.id));
  return productos
    .map((p) => ({ ...p.toJSON(), stock: stocks[p.id] ?? 0 }))
    .filter((p) => p.stock < Number(p.minStock))
    .sort((a, b) => a.stock - b.stock);
}

/**
 * Registra un movimiento. **Es la única forma de mover stock**: escribir en
 * `stock_movements` desde fuera de aquí se salta la validación.
 *
 * `tx` es opcional pero se pasa SIEMPRE desde Pedidos: descontar stock y marcar
 * el pedido como completado tienen que ocurrir juntos o no ocurrir.
 */
export async function moverStock(tenantModels, { productId, quantity, type, reason = null, entryId = null, orderId = null, teamMemberId = null, movedAt = null }, tx = null) {
  const { StockMovement } = tenantModels;
  const cantidad = Number(quantity);
  if (!productId) throw new Error("Falta el producto");
  if (!Number.isFinite(cantidad) || cantidad === 0) {
    // Un movimiento de cero no es un movimiento: ensucia el histórico sin
    // cambiar nada.
    throw new Error("La cantidad tiene que ser un número distinto de cero");
  }
  return StockMovement.create(
    {
      productId,
      quantity: cantidad,
      type: type ?? (cantidad > 0 ? "entrada" : "salida"),
      reason,
      entryId,
      orderId,
      teamMemberId,
      movedAt: movedAt ?? new Date(),
    },
    tx ? { transaction: tx } : undefined
  );
}
