/**
 * lib/tienda/pedidoDesdeTienda.js — convertir un carrito en un pedido de verdad.
 *
 * (Fichero nuevo en /lib, regla #2: lo usan el checkout público y el webhook de
 * Stripe, y mañana cualquier reintento. La conversión carrito → pedido tiene
 * que estar escrita UNA vez o acabará habiendo dos versiones que calculan
 * totales distintos.)
 *
 * ── EL TRÍO, EN ORDEN ──────────────────────────────────────────────────────
 * Rodrigo, 25/08/2026: «que los productos cuando se pidan vayan a Pedidos y que
 * estén alojados en Inventario». Eso, hecho de verdad, son tres cosas:
 *
 *   1. El comprador se convierte en ficha de **Clientes** (o se reconoce por
 *      su correo, si ya compró antes).
 *   2. El carrito se convierte en un **Pedido** con sus líneas.
 *   3. Al COBRARSE, y solo entonces, se descuenta **Inventario** con un
 *      movimiento de tipo `pedido`.
 *
 * ── POR QUÉ EL STOCK SE DESCUENTA AL PAGAR Y NO AL PEDIR ───────────────────
 * Porque un carrito abandonado no es una venta. Si el stock bajara al crear el
 * pedido, cada persona que llega al pago y no lo termina dejaría una camiseta
 * apartada que nadie recupera, y en una tirada de cincuenta eso se nota en dos
 * días. El pedido nace en `draft`; el webhook de Stripe lo pasa a `confirmed` y
 * es ahí donde se mueve el almacén.
 *
 * ── LOS PRECIOS NO LLEGAN DEL NAVEGADOR ────────────────────────────────────
 * Del carrito solo se acepta QUÉ y CUÁNTOS. El precio se lee de la base en el
 * momento de cobrar. Es la misma regla que `lib/payments/checkout.js`.
 */

import { esVendible, precioDe } from "./catalogo.js";
// De `errorTypes.js` y NO de `errors.js`: aquel no depende de `next/server`, y
// esa dependencia deja el fichero inservible desde un script de línea de
// comandos — que es justo donde se prueba esto. El desdoble existe por ese
// motivo, explicado en la cabecera de `lib/utils/errorTypes.js`.
import { ValidationError } from "../utils/errorTypes.js";

const MAX_LINEAS = 30;
const MAX_UNIDADES = 99;

/**
 * Lee el carrito que manda el navegador y lo convierte en líneas con PRECIO DE
 * SERVIDOR. Devuelve `{ lineas, subtotal }` o lanza si algo no cuadra.
 *
 * @param {object} models  ctx.tenantModels
 * @param {Array}  carrito `[{ productoId, varianteId?, unidades }]`
 */
export async function lineasDesdeCarrito(models, carrito) {
  if (!Array.isArray(carrito) || !carrito.length) {
    throw new ValidationError("El carrito está vacío");
  }
  if (carrito.length > MAX_LINEAS) {
    throw new ValidationError("Demasiadas líneas en el carrito");
  }

  const { Product, ProductVariant } = models;
  const ids = [...new Set(carrito.map((l) => String(l.productoId || "")))].filter(Boolean);
  if (!ids.length) throw new ValidationError("El carrito no trae ningún producto");

  const productos = await Product.findAll({
    where: { id: ids },
    include: [{ model: ProductVariant, as: "variants", required: false }],
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  const lineas = [];
  for (const item of carrito) {
    const p = porId.get(String(item.productoId));
    // Un producto que se despublicó mientras alguien tenía el carrito abierto
    // NO se cobra a medias: se para y se dice cuál, para que pueda quitarlo.
    if (!p || !esVendible(p)) {
      throw new ValidationError(`«${p?.name ?? "Un producto"}» ya no está disponible`);
    }

    let variante = null;
    if (item.varianteId) {
      variante = (p.variants || []).find((v) => v.id === String(item.varianteId) && v.active) ?? null;
      if (!variante) throw new ValidationError(`Esa opción de «${p.name}» ya no está disponible`);
    } else if ((p.variants || []).some((v) => v.active)) {
      // Con variantes, elegir una es obligatorio: cobrar una camiseta sin talla
      // deja un pedido que no se puede servir.
      throw new ValidationError(`Elige una opción de «${p.name}»`);
    }

    const unidades = Math.floor(Number(item.unidades));
    if (!Number.isFinite(unidades) || unidades < 1 || unidades > MAX_UNIDADES) {
      throw new ValidationError(`Cantidad no válida en «${p.name}»`);
    }

    const precio = precioDe(p, variante);
    lineas.push({
      productId: p.id,
      productName: p.name,
      variantId: variante?.id ?? null,
      variantName: variante?.name ?? null,
      quantity: unidades,
      unitPrice: precio.toFixed(2),
      lineTotal: (precio * unidades).toFixed(2),
    });
  }

  const subtotal = lineas.reduce((a, l) => a + Number(l.lineTotal), 0);
  return { lineas, subtotal: Number(subtotal.toFixed(2)) };
}

/**
 * La ficha del comprador. Si ya compró antes se reutiliza; si no, se crea.
 *
 * Se casa por CORREO en minúsculas porque es lo único que la persona vuelve a
 * escribir igual. El nombre no vale: «Laura Úbeda» y «laura ubeda» son la misma
 * y crearían dos fichas.
 */
export async function fichaDelComprador(models, { email, nombre, telefono }) {
  const { Client } = models;
  const correo = String(email || "").trim().toLowerCase();
  if (!correo) throw new ValidationError("Hace falta un correo para el pedido");

  const existente = await Client.findOne({ where: { email: correo } });
  if (existente) return { cliente: existente, creada: false };

  const cliente = await Client.create({
    type: "individual",
    name: String(nombre || correo).trim().slice(0, 200),
    email: correo,
    phone: String(telefono || "").trim().slice(0, 40) || null,
    // `prospect` y no `active`: ha comprado una vez, todavía no es cartera.
    status: "prospect",
    customFields: { origen: "tienda" },
  });
  return { cliente, creada: true };
}

/**
 * Descuenta el almacén de un pedido ya PAGADO.
 *
 * Idempotente: si ya hay movimientos de este pedido no vuelve a descontar. El
 * webhook de Stripe puede llegar dos veces —lo reintenta si la primera
 * respuesta tarda— y cobrar una vez y descontar dos dejaría el stock en
 * negativo sin que nadie entienda por qué.
 */
export async function descontarStock(models, pedido, lineas) {
  const { StockMovement } = models;

  const yaHechos = await StockMovement.count({ where: { orderId: pedido.id } });
  if (yaHechos > 0) return { movimientos: 0, repetido: true };

  let n = 0;
  for (const l of lineas) {
    await StockMovement.create({
      productId: l.productId,
      variantId: l.variantId ?? null,
      // NEGATIVO: sale del almacén. El stock es la suma de movimientos, así que
      // una salida es una cantidad en negativo y no un campo aparte.
      quantity: -Math.abs(Number(l.quantity)),
      type: "pedido",
      reason: `Pedido de la tienda`,
      orderId: pedido.id,
      movedAt: new Date(),
    });
    n++;
  }
  return { movimientos: n, repetido: false };
}
