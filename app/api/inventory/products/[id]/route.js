import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";
import { stockDe } from "../../../../../lib/inventory/stock.js";
import { UNIDADES } from "../../../../../models/tenant/Product.model.js";
import { camposEscaparateDe, estorbaParaPublicar } from "../../../../../lib/tienda/camposEscaparate.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Product, StockEntry, Supplier } = tenantModels;
  const { id } = await params;

  const product = await Product.findByPk(id, {
    include: [{
      model: StockEntry, as: "entries",
      include: [{ model: Supplier, as: "supplier", attributes: ["id", "name"] }],
    }],
    order: [[{ model: StockEntry, as: "entries" }, "entryDate", "DESC"]],
  });
  if (!product) return notFound("Producto no encontrado");

  const stock = await stockDe(tenantModels, id);
  const min = product.minStock === null ? null : Number(product.minStock);
  return ok({ ...product.toJSON(), stock, bajoMinimo: min !== null && stock < min });
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Product } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const product = await Product.findByPk(id);
  if (!product) return notFound("Producto no encontrado");

  if ("name" in body && !body.name?.trim()) return error("El nombre es obligatorio", 422);
  if ("unit" in body && !UNIDADES.includes(body.unit)) {
    return error(`Unidad no válida. Usa una de: ${UNIDADES.join(", ")}`, 422);
  }
  // Cambiar la unidad con movimientos ya registrados reinterpretaría el
  // histórico: 400 «unidades» pasarían a ser 400 «kilos» de golpe. Se bloquea.
  if ("unit" in body && body.unit !== product.unit) {
    const stock = await stockDe(tenantModels, id);
    if (stock !== 0) {
      return error(
        `No se puede cambiar la unidad: este producto ya tiene movimientos (stock ${stock} ${product.unit}). ` +
        `Ajusta el stock a cero o crea un producto nuevo con la unidad correcta.`,
        409
      );
    }
  }

  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const cambios = {};
  if ("name" in body) cambios.name = body.name.trim();
  if ("unit" in body) cambios.unit = body.unit;
  for (const c of ["sku", "category", "notes"]) if (c in body) cambios[c] = body[c]?.trim() || null;
  for (const c of ["purchasePrice", "salePrice", "minStock"]) if (c in body) cambios[c] = num(body[c]);
  if ("active" in body) cambios.active = !!body.active;

  // Los campos de escaparate (25/08/2026): slug, descripción, fotos, publicado
  // e IVA. Solo entra lo que venga en el body, así que un PATCH que cambia el
  // precio no borra la descripción por no mandarla.
  const { campos: escaparate, error: errEscaparate } = camposEscaparateDe(body, { nombre: cambios.name ?? product.name });
  if (errEscaparate) return error(errEscaparate, 422);
  Object.assign(cambios, escaparate);

  // Publicar sin precio deja en el escaparate algo que nadie puede comprar, y
  // el fallo se ve en la web y no aquí. Se para antes.
  if (cambios.publicado === true) {
    const estorbo = estorbaParaPublicar({ ...product.toJSON(), ...cambios });
    if (estorbo) return error(estorbo, 422);
  }

  await product.update(cambios);
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.product.updated",
    entity: "Product",
    entityId: product.id,
    after: resumen(product, ["name", "unit", "salePrice", "active"]),
  });

  const stock = await stockDe(tenantModels, id);
  return ok({ ...product.toJSON(), stock });
});

/**
 * Retirar del catálogo. NO borra si tiene movimientos: el histórico del almacén
 * apunta aquí y borrarlo lo dejaría sin nombre.
 */
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Product, StockMovement } = tenantModels;
  const { id } = await params;

  const product = await Product.findByPk(id);
  if (!product) return notFound("Producto no encontrado");

  const movimientos = await StockMovement.count({ where: { productId: id } });
  if (movimientos > 0) {
    await product.update({ active: false });
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "inventory.product.deactivated",
      entity: "Product",
      entityId: product.id,
      before: resumen(product, ["name", "unit", "active"]),
    });
    return ok({ desactivado: true, movimientos, mensaje: `Retirado: conserva ${movimientos} movimiento(s) de histórico` });
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.product.deleted",
    entity: "Product",
    entityId: product.id,
    before: resumen(product, ["name", "unit"]),
  });
  await product.destroy();
  return ok({ eliminado: true });
});
