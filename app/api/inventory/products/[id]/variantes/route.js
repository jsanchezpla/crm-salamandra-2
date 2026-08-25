import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, notFound } from "../../../../../../lib/utils/apiResponse.js";

/**
 * /api/inventory/products/:id/variantes — las tallas, colores y capacidades.
 *
 * Cuelga de Inventario y no de la tienda a propósito: una variante es una cosa
 * del ALMACÉN —tiene su SKU y su stock— y existe aunque el producto no esté a
 * la venta. Un centro que solo lleva inventario puede querer distinguir la caja
 * de guantes S de la L sin tener tienda ninguna.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VARIANTES = 40;

async function productoOFalla(ctx, id) {
  if (!UUID_RE.test(id ?? "")) return { err: error("Identificador inválido", 422) };
  const p = await ctx.tenantModels.Product.findByPk(id, { attributes: ["id", "name"] });
  if (!p) return { err: notFound("Producto no encontrado") };
  return { producto: p };
}

/** GET — las variantes, en su orden. */
export const GET = withTenant(async (_request, { params }, ctx) => {
  if (!ctx.hasModule("inventory")) return forbidden();
  const { id } = await params;
  const { err } = await productoOFalla(ctx, id);
  if (err) return err;

  const { ProductVariant } = ctx.tenantModels;
  const variantes = await ProductVariant.findAll({
    where: { productId: id },
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"],
    ],
  });
  return ok({ variantes });
});

/**
 * PUT — reemplaza la lista entera.
 *
 * Se guarda todo de golpe y no variante a variante porque así es como se edita:
 * quien abre «Tallas» de una camiseta añade la XL, corrige el precio de la XXL
 * y quita la XS en el mismo gesto. Tres llamadas separadas dejarían estados a
 * medias si una falla.
 *
 * Las que ya existían se ACTUALIZAN por id; las que desaparecen de la lista se
 * DESACTIVAN, nunca se borran: un pedido viejo apunta a ellas y su nombre tiene
 * que poder leerse.
 */
export const PUT = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("inventory")) return forbidden();
  const { id } = await params;
  const { err } = await productoOFalla(ctx, id);
  if (err) return err;

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido", 422);
  }
  const lista = Array.isArray(body?.variantes) ? body.variantes : null;
  if (!lista) return error("«variantes» tiene que ser una lista", 422);
  if (lista.length > MAX_VARIANTES) return error(`Máximo ${MAX_VARIANTES} variantes por producto`, 422);

  const { ProductVariant } = ctx.tenantModels;
  const existentes = await ProductVariant.findAll({ where: { productId: id } });
  const porId = new Map(existentes.map((v) => [v.id, v]));
  const vistos = new Set();

  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

  for (const [i, bruto] of lista.entries()) {
    const nombre = String(bruto?.name ?? "").trim().slice(0, 120);
    if (!nombre) return error("Cada variante necesita un nombre («Talla M», «500 litros»…)", 422);

    const precio = num(bruto.salePrice);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return error(`Precio no válido en «${nombre}»`, 422);
    }

    const datos = {
      name: nombre,
      sku: String(bruto?.sku ?? "").trim().slice(0, 80) || null,
      salePrice: precio,
      sortOrder: i,
      active: bruto?.active === undefined ? true : !!bruto.active,
    };

    const previa = bruto?.id ? porId.get(String(bruto.id)) : null;
    if (previa) {
      await previa.update(datos);
      vistos.add(previa.id);
    } else {
      const nueva = await ProductVariant.create({ productId: id, ...datos });
      vistos.add(nueva.id);
    }
  }

  // Las que ya no vienen: se apagan, no se borran. Ver la cabecera.
  const desactivadas = [];
  for (const v of existentes) {
    if (vistos.has(v.id) || !v.active) continue;
    await v.update({ active: false });
    desactivadas.push(v.name);
  }

  const variantes = await ProductVariant.findAll({
    where: { productId: id },
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"],
    ],
  });

  return created({ variantes, desactivadas });
});
