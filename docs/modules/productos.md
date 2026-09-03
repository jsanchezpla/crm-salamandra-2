# Módulo Productos (`productos` / `productos_avanzado`)

**moduleKey:** `productos` (básico) · `productos_avanzado` (avanzado) ·
**Estado:** construido el 03/09/2026 · **De quién cuelgan:** `inventory`,
`orders` y `tienda` (los tres exigen el avanzado en el menú) · **Requiere:**
el básico nada; el avanzado, el básico.

## Mapa

| Qué | Dónde |
| --- | --- |
| Pantalla (`/productos`): lista, alta, edición, precio, retirada; con el avanzado, el bloque de ventas y los accesos a los tres | `app/(dashboard)/productos/page.jsx` (server: mira los módulos del tenant y hace `notFound()` sin el básico) → `modules/productos/ProductosModule.jsx` (props `avanzado`, `conInventario`, `conPedidos`, `conTienda`) |
| Endpoints del catálogo (los de siempre, con otra puerta) | `app/api/inventory/products/route.js` (GET/POST) y `products/[id]/route.js` (GET/PUT/DELETE): **gateados por `productos`** desde el 03/09/2026 (antes `inventory`). La ruta no se movió: Inventario y Tienda la siguen llamando. |
| Estadísticas de venta (solo dirección) | `app/api/productos/estadisticas/route.js` → `lib/productos/estadisticas.js` (`gateEstadisticasProductos`, `calcularEstadisticasProductos`, que lee pedidos, fichas y —con `inventory`— entradas de almacén) → `lib/productos/ventas.js` (`agregarVentas` y `costesUnitarios`, puras, con prueba); gateado por `productos_avanzado` + rol admin |
| El periodo «desde / hasta» | `lib/utils/rangoFechas.js` (`rangoPedido`) sobre `lib/utils/fechaLocal.js` (`fechaISO`, `rangoDe`, puros), compartidos con `lib/clinica/estadisticas.js` |
| Claves | `lib/tenant/moduleKeys.js` (`PRODUCTOS`, `PRODUCTOS_AVANZADO`, `INVENTORY`, `ORDERS`, `TIENDA`) |
| Menú | `components/layout/Sidebar.jsx`, sección «Operaciones»: `productos` con hijos Inventario / Pedidos / Tienda (`requiresAll: ["productos_avanzado", "<clave>"]`) |
| Venta y dependencias | `lib/provisioning/catalogo.js` (grupo «Productos»: los cinco) · `lib/provisioning/dependencias.js` (`productos`, `productos_avanzado`, y las obligatorias nuevas de `inventory`, `orders`, `tienda`) |
| Migraciones | `productos` y `productos_avanzado` → `migrate-inventario-rework` (comparten `products` con Inventario); `orders` → `migrate-orders` (nueva: las tres tablas de Pedidos, sin ENUM). Mapa en `scripts/_module-migrations.js`; arista `migrate-orders` → `migrate-tienda` en `scripts/_migration-order.js` |
| Reparto a quien ya tenía el trío (MASTER, una vez) | `scripts/migrate-productos.js` (idempotente; `ONE_OFF` del mapa) |
| Tablas por módulo | `scripts/check-module-tables.js` (`productos`: `products`; `productos_avanzado`: `products` + `orders`/`order_lines` como extras) |
| Pruebas | `scripts/_smoke-productos.mjs` (el cálculo de ventas y las puertas) · `scripts/_smoke-provisioning-dependencias.mjs` (la matriz) |
| Demos | `lib/demo/demos.js` (`demo_agencia` lleva los dos niveles con `orders`) · `scripts/rebuild-demo-showcase.js` (la general) |

---

## Qué es

Rodrigo (03/09/2026): «agrupar el módulo de Inventario, Pedidos y Tienda en un
gran módulo llamado PRODUCTOS. Ese módulo tendrá estadísticas y podré poner ahí
los productos que vendo y su valor. Productos tendrá básico y avanzado.»

| Nivel | Qué incluye |
| --- | --- |
| `productos` | La pantalla general: el catálogo de lo que se vende, con referencia, categoría, en qué se cuenta, **precio de venta** (el valor) y precio de compra. Alta, edición, retirada y reactivación. |
| `productos_avanzado` | Lo mismo **más** el bloque «Ventas» encima de la lista (vendido, unidades, ticket medio, sin vender, lo más vendido, por mes, por dónde entra) y la puerta a **Inventario, Pedidos y Tienda**, que cuelgan de él en el menú. |

Los tres de abajo siguen siendo módulos con su clave: se marcan aparte en el
alta (lo que entra en la lista entra en la factura del cliente, ver
`dependencias.js`) y cada uno conserva sus tablas, endpoints y pantalla. Lo
que cambia es que ninguno se ve sin el avanzado, y que **el producto y su
valor son de Productos**:

- **Inventario** ya no da de alta ni edita productos: es el almacén (entradas,
  ajustes, stock, histórico). Su lista es la del catálogo.
- **Tienda** ya no edita el precio: lo enseña y dice dónde se cambia. Sigue
  decidiendo qué se publica, la descripción, las fotos, el IVA y las tallas
  (cuyo precio propio es una excepción al base, no una copia).
- **Pedidos** no cambia por dentro; sus líneas siguen heredando el precio del
  producto y siendo editables (foto del momento).

## Una sola tabla

No hay tabla nueva. `products` es la del rework de Inventario del 02/08/2026
(`scripts/migrate-inventario-rework.js`), con las columnas de escaparate que le
añadió la Tienda. Por eso `productos` y `productos_avanzado` declaran esa misma
migración en el mapa, igual que `documents_avanzado` comparte con `documents`:
un cliente que estrene el básico sin haber tenido Inventario nace con la tabla
(y con `stock_entries` y `stock_movements`, que la lista necesita para calcular
el stock, aunque salga a cero).

## Las estadísticas

`GET /api/productos/estadisticas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`. Sin
fechas, el mes en curso. Solo dirección (`admin`/`superadmin`), como las del
centro en Clínica: son cifras de dinero de todo el equipo.

- **Venta** = pedido en `confirmed`, `preparing`, `shipped` o `completed`, por
  la fecha en que se hizo (`createdAt`). Los borradores no cuentan (un carrito
  de la tienda es `draft` hasta que Stripe lo confirma); los cancelados se
  enseñan aparte.
- Devuelve `totales` (pedidos, importe, unidades, ticket medio, cancelados,
  borradores), `porProducto` (ranking por importe; las líneas sin producto del
  catálogo se agrupan por nombre), `porMes`, `porOrigen` (`manual` = mostrador,
  `tienda`) y `sinVentas` (productos activos que no vendieron nada).
- Si el cliente tiene el avanzado pero no las tablas de Pedidos, responde
  `disponible: false` y la pantalla lo explica; no un 500.
- **El margen** (03/09/2026): `margen` (`importe`, `pct`, `sobreImporte`,
  `sinCoste`, `fuente`) y, en cada fila de `porProducto`, `coste` y `margen`.
  Es lo cobrado por cada línea menos `coste unitario × cantidad`. El coste lo
  arma `costesUnitarios`: con Inventario, la media ponderada de las entradas
  con coste de ese producto (`StockEntry.unitCost`, lo que se pagó de verdad);
  si no hay, el precio de compra de la ficha (`Product.purchasePrice`, el POR
  DEFECTO), y `fuente` dice cuál ha mandado. Un producto sin coste conocido
  sale `null` —no se sabe, que no es cero— y `pct` va solo sobre lo que sí
  tiene coste (`sobreImporte`), con `sinCoste` al lado para que el porcentaje
  no se lea como el de todo. El precio de compra no sale de este endpoint
  hacia ningún sitio público (es de dirección; `paraLaTienda` lo tapa en la
  tienda).

## Activar

- Cliente nuevo: se marca en el alta (`/admin/clientes`), grupo «Productos».
  El alta exige el básico para el avanzado, y el avanzado para cualquiera de
  los tres; ofrece completar la cadena de un clic.
- Cliente en marcha: `node scripts/enable-module.js <slug> productos` y luego
  `… productos_avanzado`. Para Pedidos, `enable-module.js <slug> orders` corre
  ahora `migrate-orders` (antes no creaba tablas: solo existían por un script
  de `_hechos/` con el slug dentro).
- **Quien ya tenía Inventario, Pedidos o Tienda** recibe los dos niveles con
  `scripts/migrate-productos.js`, que se lanza en producción ANTES de desplegar (hoy: aumenta, demo,
  demo_agencia, laura_ubeda, somos). Se puede relanzar: no duplica.

## Lo que NO hace (todavía)

- Excel o PDF de las ventas: el cálculo está preparado para compartirse
  (`agregarVentas` es pura), pero solo hay pantalla.
- Ventas por variante (talla): el ranking va por producto.
