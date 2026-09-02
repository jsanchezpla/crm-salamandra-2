import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { esVendible, paraLaTienda } from "../../../../../../lib/tienda/catalogo.js";

/**
 * GET /api/public/c/[tenantSlug]/tienda — el catálogo público.
 *
 * Sin JWT: lo pide cualquiera que abra la tienda. Por eso solo salen los
 * productos PUBLICADOS y solo los campos del escaparate — `paraLaTienda()` se
 * encarga de que el precio de compra no viaje nunca al navegador.
 *
 * `?slug=` devuelve una sola ficha, que es lo que pide la página de producto.
 */
export const GET = withPublicTenant(async (request, _ctxRuta, ctx) => {
  try {
    const { tenant, tenantModels, hasModule } = ctx;
    if (!hasModule("tienda")) return notFound("Aquí no hay tienda");

    const { Product, ProductVariant } = tenantModels;
    const slug = new URL(request.url).searchParams.get("slug");

    const where = { publicado: true, active: true };
    if (slug) where.slug = String(slug).slice(0, 160);

    const filas = await Product.findAll({
      where,
      include: [{ model: ProductVariant, as: "variants", required: false }],
      order: [
        ["sortOrder", "ASC"],
        ["name", "ASC"],
      ],
      limit: slug ? 1 : 200,
    });

    // `esVendible` se aplica DESPUÉS de la consulta y no en el `where`: un
    // producto publicado al que se le olvidó el precio no debe salir a la
    // venta, pero tampoco desaparecer sin que se sepa por qué. Aquí se cae de
    // la lista y en el CRM sigue viéndose con su aviso.
    const productos = filas
      .filter((p) => esVendible(p))
      .map((p) => paraLaTienda(p, p.variants));

    if (slug) {
      if (!productos.length) return notFound("Producto no encontrado");
      return ok({ producto: productos[0], marca: marcaDe(tenant) });
    }
    return ok({ productos, total: productos.length, marca: marcaDe(tenant) });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * Los colores que la tienda pinta. `tiendaColor` es opcional y manda sobre el
 * primario en los botones: nació con laura_ubeda (26/08/2026), cuyo primario
 * es el negro del sidebar del CRM y sus botones de tienda van en rosa. Sin
 * él, el acento ES el primario, como en cualquier otro tenant.
 *
 * OJO: NO se llama accentColor. Esa clave ya existe en la marca y es el FONDO
 * del CRM (beige #EDE8DE por defecto): el 02/09/2026 se usó por error para la
 * tienda y el panel de Laura amaneció rosa de arriba abajo.
 */
function marcaDe(tenant) {
  const brand = tenant?.settings?.brand ?? {};
  const principal = brand.primaryColor || "#111111";
  return { principal, acento: brand.tiendaColor || principal };
}
