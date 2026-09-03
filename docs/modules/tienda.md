# Módulo Tienda (`tienda`)

**moduleKey:** `tienda` · **Estado:** implementado el 25/08/2026 ·
**Cliente de referencia:** `laura_ubeda` (merch de Laura Úbeda) · **Requiere:**
`inventory` + `orders` + `clients` y, desde el 03/09/2026, `productos` +
`productos_avanzado` (cuelga de Productos en el menú; el producto y su precio
son de ese módulo — `docs/modules/productos.md`)

## Mapa

| Qué | Dónde |
| --- | --- |
| Pantalla del CRM (publicar, ficha, tallas; **el precio se enseña, no se edita**: es de `/productos`) | `modules/tienda/TiendaModule.jsx` → `/tienda` |
| Tienda pública (catálogo, ficha, carrito) | `app/widget/c/[tenantSlug]/tienda/page.jsx` (+ `gracias/`) |
| API pública del catálogo | `app/api/public/c/[tenantSlug]/tienda/route.js` (`?slug=` para uno) |
| API pública del pedido | `app/api/public/c/[tenantSlug]/tienda/pedido/route.js` |
| Variantes (tallas/opciones) | `app/api/inventory/products/[id]/variantes/route.js` (GET/PUT) — **gateado por `inventory`, no por `tienda`** |
| Campos de escaparate en el producto | `PUT /api/inventory/products/[id]` (parcial) vía `lib/tienda/camposEscaparate.js` — gateado por `productos` desde el 03/09/2026 |
| Qué se vende y a qué precio | `lib/tienda/catalogo.js` (`esVendible`, `precioDe`, `paraLaTienda`) |
| Carrito → Pedido → Stripe | `lib/tienda/pedidoDesdeTienda.js` + `lib/payments/checkout.js` (`entityType: "order"`) |
| Pago confirmado → stock | `lib/payments/entityHooks.js` (`pedidoPagado`) |
| Modelo de variantes | `models/tenant/ProductVariant.model.js` |
| Migración | `scripts/migrate-tienda.js` (aditiva, idempotente) |
| Shortcode de WordPress | `docs/modules/tienda-wordpress-snippet.php` (`[crm_tienda]`) |

---

## El trío: Tienda → Pedidos → Inventario

Frase de Rodrigo (24/08/2026): «que los productos cuando se pidan vayan a
Pedidos y que estén alojados en Inventario, es el trío perfecto». El módulo no
inventa un catálogo aparte:

- Los productos **son los del catálogo** (`products`; hasta el 03/09/2026 se
  decía «los de Inventario», y desde entonces el catálogo y su precio son del
  módulo Productos, del que Inventario y esta tienda cuelgan). La tienda solo
  añade campos de escaparate encima: `slug`, `description`, `images`,
  `publicado`, `tax_rate`, `sort_order`. **El precio no se toca aquí.**
- Una compra crea un **pedido normal** (`orders`, origen `tienda`) con sus
  líneas. Se ve en `/pedidos` como cualquier otro.
- El stock **es la suma de movimientos**, como desde el rework del 02/08/2026:
  pagar un pedido crea movimientos tipo `pedido` en negativo, uno por línea.

## El ciclo de un pedido

```
carrito (navegador) ──POST /tienda/pedido──▶ Client (por email, o se crea)
                                            Order en DRAFT + OrderLines
                                            └─▶ Stripe Checkout (checkoutUrl)
comprador paga ──webhook──▶ entityHooks.pedidoPagado:
                              draft → confirmed + descuenta stock
comprador vuelve a /tienda/gracias (solo informa y vacía el carrito)
```

Tres decisiones de seguridad que no hay que deshacer:

1. **El precio se lee SIEMPRE en el servidor** (`precioDe`). El body del
   carrito trae ids y cantidades; un precio inventado se ignora.
2. **El borrador no descuenta stock.** Solo el webhook confirma y descuenta, y
   es idempotente: si Stripe reintenta, no descuenta dos veces
   (`status !== "draft"` → no hace nada).
3. **La página de gracias no confirma nada.** A esa URL se llega escribiéndola
   a mano.

## Variantes (tallas, capacidades, colores)

Un solo eje (`ProductVariant`: nombre, sku, precio opcional, orden). «Talla M»
y «500 litros» son lo mismo para el modelo. El precio en blanco **hereda** el
del producto; si alguna variante difiere, el catálogo enseña «desde X €»
(`precioDesde`). Se editan con un PUT que reemplaza la lista entera; las que
desaparecen se **desactivan**, nunca se borran (los pedidos viejos las
apuntan). Viven bajo `inventory` a propósito: son cosa del almacén y existen
aunque no haya tienda.

## Publicar

`publicado` es el interruptor por producto. El servidor no deja publicar sin
precio (`estorbaParaPublicar`): el fallo se vería en la web y no en el CRM.
`purchasePrice` (lo que nos cuesta) **jamás se serializa** hacia la tienda
pública (`paraLaTienda`).

## «Conectarse a la tienda de una URL elegida»

La URL la elige quien crea la página en WordPress: shortcode `[crm_tienda]`
(iframe del widget). El pago salta a Stripe con `window.top.location` porque
Checkout no se deja pintar dentro de un iframe. El dominio de la web tiene que
estar en `WIDGET_FRAME_ANCESTORS` del `.env.production` o el iframe sale en
blanco. También funciona a pelo, sin WordPress: la URL del widget es pública.

## Por qué `tienda` es un módulo aparte y no parte de `inventory`

Se vende aparte (la prueba del caso 3a: ¿se lo venderíamos a un segundo
cliente? — sí, a cualquiera con ecommerce), y hay clientes de inventario que no
quieren escaparate. `tienda` sin `inventory`+`orders`+`clients` no tiene
sentido: la dependencia está declarada en `lib/provisioning/dependencias.js` y
el catálogo comercial (`lib/provisioning/catalogo.js`).

## Lo que NO hace (todavía)

- **Stock por variante en la ficha pública**: el movimiento sí guarda
  `variant_id`, pero la tienda no frena la compra de una talla agotada (solo
  del producto entero). Se apuntará cuando duela.
- **Envíos**: la dirección se guarda en el pedido (`shipping_address`); no hay
  cálculo de gastos de envío. El precio es el del producto.
- **Fotos subidas al CRM**: las imágenes son URLs (normalmente del WordPress
  del cliente). `normalizarImagenes` bloquea `javascript:` y `data:`.
