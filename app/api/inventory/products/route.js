import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { stockDeVarios } from "../../../../lib/inventory/stock.js";
import { UNIDADES } from "../../../../models/tenant/Product.model.js";
import { Op } from "sequelize";
import { camposEscaparateDe, estorbaParaPublicar } from "../../../../lib/tienda/camposEscaparate.js";

/**
 * Productos del almacén (rework 02/08/2026).
 *
 * Una sola lista para lo que entra y lo que sale: un centro clínico compra
 * guantes y saca guantes. El stock viene calculado —suma de movimientos— y
 * SIEMPRE acompañado de su unidad, porque un «400» a secas no dice si son
 * unidades o kilos, que es el fallo del módulo viejo.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("productos")) return forbidden();

  const { Product } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const category = searchParams.get("category");
  const verInactivos = searchParams.get("verInactivos") === "1";
  const soloBajoMinimo = searchParams.get("bajoMinimo") === "1";

  const where = {};
  if (!verInactivos) where.active = true;
  if (category) where.category = category;
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { sku: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const productos = await Product.findAll({ where, order: [["name", "ASC"]] });
  const stocks = await stockDeVarios(tenantModels, productos.map((p) => p.id));

  let filas = productos.map((p) => {
    const stock = stocks[p.id] ?? 0;
    const min = p.minStock === null ? null : Number(p.minStock);
    return { ...p.toJSON(), stock, bajoMinimo: min !== null && stock < min };
  });
  if (soloBajoMinimo) filas = filas.filter((p) => p.bajoMinimo);

  return ok({
    products: filas,
    total: filas.length,
    // Para el aviso de la cabecera, sin tener que recorrer la lista en el front.
    conAviso: filas.filter((p) => p.bajoMinimo).length,
    // Las categorías que existen de verdad, para el desplegable del filtro.
    categorias: [...new Set(productos.map((p) => p.category).filter(Boolean))].sort(),
  });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("productos")) return forbidden();

  const { Product } = tenantModels;
  const body = await request.json();

  const name = body.name?.trim();
  if (!name) return error("El nombre del producto es obligatorio", 422);

  const unit = body.unit ?? "ud";
  if (!UNIDADES.includes(unit)) {
    return error(`Unidad no válida. Usa una de: ${UNIDADES.join(", ")}`, 422);
  }

  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

  // Los campos de escaparate (25/08/2026). Se aceptan en el alta para poder
  // crear un producto ya publicado de una vez, sin tener que editarlo después.
  const { campos: escaparate, error: errEscaparate } = camposEscaparateDe(body, { nombre: name });
  if (errEscaparate) return error(errEscaparate, 422);

  const product = await Product.create({
    name,
    sku: body.sku?.trim() || null,
    category: body.category?.trim() || null,
    unit,
    purchasePrice: num(body.purchasePrice),
    salePrice: num(body.salePrice),
    minStock: num(body.minStock),
    notes: body.notes?.trim() || null,
    ...escaparate,
  });

  // Un producto recién creado tiene stock 0 por definición: no hay movimientos.
  // Se devuelve explícito para que el front no tenga que suponerlo.
  return created({ ...product.toJSON(), stock: 0, bajoMinimo: false });
});
