/**
 * lib/tienda/catalogo.js — qué se ve en la tienda y a qué precio.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint público del
 * catálogo, el de la ficha y el que calcula el total antes de cobrar. El
 * precio SOBRE TODO tiene que salir de un solo sitio — es lo que impide que
 * el escaparate diga 18 € y el cobro haga 15 €.)
 *
 * ── LA REGLA QUE MANDA ─────────────────────────────────────────────────────
 * El precio se calcula SIEMPRE en el servidor a partir de la base de datos,
 * nunca de lo que mande el navegador. Es la misma decisión que ya tomó
 * `lib/payments/checkout.js` con las citas y por el mismo motivo: si el importe
 * viaja en el body, cualquiera paga un céntimo por un congelador.
 */

/** Lo que se puede vender: publicado, activo y con precio. */
export function esVendible(producto) {
  if (!producto) return false;
  if (!producto.publicado || !producto.active) return false;
  return precioDe(producto) > 0;
}

/**
 * El precio de un producto o de una de sus variantes, en euros.
 *
 * La variante sin precio HEREDA el del producto: una camiseta con cuatro tallas
 * al mismo precio se define una vez. Ver `ProductVariant`.
 */
export function precioDe(producto, variante = null) {
  const propio = variante && variante.salePrice != null ? variante.salePrice : producto?.salePrice;
  const n = Number(propio);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Céntimos, que es lo que quiere Stripe. Se redondea una sola vez, al final. */
export function centimos(euros) {
  return Math.round(Number(euros) * 100);
}

/**
 * El IVA de un producto en tanto por uno. Sin `taxRate` propio se usa el del
 * centro; sin ninguno de los dos, cero — y entonces el precio se trata como
 * final, que es lo que espera quien vende a particulares.
 */
export function ivaDe(producto, porDefecto = 0) {
  const t = producto?.taxRate != null ? Number(producto.taxRate) : Number(porDefecto);
  return Number.isFinite(t) && t > 0 ? t / 100 : 0;
}

/**
 * Serializa un producto para el escaparate. NUNCA devuelve `purchasePrice`:
 * el precio al que se compró es de la casa, y ha salido a la web más de una vez
 * en más de un CRM por serializar la fila entera.
 */
export function paraLaTienda(producto, variantes = []) {
  const activas = (variantes || []).filter((v) => v.active);
  return {
    id: producto.id,
    slug: producto.slug,
    nombre: producto.name,
    descripcion: producto.description ?? null,
    imagenes: Array.isArray(producto.images) ? producto.images : [],
    unidad: producto.unit,
    precio: precioDe(producto),
    // Solo se anuncia el «desde» si de verdad hay precios distintos: poner
    // «desde 18 €» cuando todas las tallas valen 18 € es ruido.
    precioDesde: (() => {
      const precios = activas.map((v) => precioDe(producto, v));
      const min = Math.min(...(precios.length ? precios : [precioDe(producto)]));
      const max = Math.max(...(precios.length ? precios : [precioDe(producto)]));
      return min !== max ? min : null;
    })(),
    variantes: activas
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({ id: v.id, nombre: v.name, precio: precioDe(producto, v) })),
  };
}
