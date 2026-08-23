# Módulo de Inventario (`inventory`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `inventory` · requiere — (`lib/provisioning/catalogo.js` no le pone `requiere`; `lib/provisioning/dependencias.js`: sin `team` las entradas y ajustes no quedan firmados, sin `orders` el stock solo baja por ajuste manual). Es Pedidos quien descuenta al vender; Facturación solo avisa. |
| **Reina** | — (ni el doc ni el código nombran una; en producción ningún cliente real tiene todavía un producto dado de alta) |
| **Pantallas** | `app/(dashboard)/inventario/page.jsx` (`/inventario`: lista con stock y unidad, filtro por categoría y bajo mínimo, ficha con el histórico de movimientos, alta de entrada con proveedor de desplegable, ajuste con motivo). Toda la pantalla vive en esa página. |
| | Los proveedores se dan de alta en `app/(dashboard)/facturacion/proveedores/page.jsx` (`/facturacion/proveedores`), que es de Facturación: entidad compartida. |
| **Endpoints** | `app/api/inventory/**` — 4 `route.js`, todos con `hasModule("inventory")`: `products`, `products/[id]`, `entries`, `stock-movements`. |
| | Tocan el stock desde otros módulos: `app/api/orders/[id]/complete/route.js` (descuenta al completar un pedido, si el tenant tiene `inventory`) y `app/api/billing/invoices/[id]/issue/route.js` (solo AVISA, vía `applyStockMovementsForInvoice`). `app/api/proveedores/**` (2) se abre con `billing` **o** `inventory`. Sin públicos ni webhooks. |
| **Lógica** | `lib/inventory/stock.js` (`stockDe`, `stockDeVarios`, `bajoMinimo`, `moverStock`: el ÚNICO sitio que escribe en `stock_movements`) · `lib/inventory/applyStockMovementsForInvoice.js` (avisa si una factura lleva productos y no viene de un pedido; ya no descuenta) |
| | Auditoría desde los endpoints: `inventory.entry.created`, `inventory.product.updated`, `inventory.product.deactivated`, `inventory.product.deleted`, `inventory.stock.adjusted`, con sus frases en `lib/actividad/etiquetas.js`. |
| **UI** | ninguna carpeta propia: no existen `modules/inventory/` ni `components/inventory/`; la pantalla está entera en `app/(dashboard)/inventario/page.jsx` (con `components/ui/HelpTooltip.jsx`) |
| **Modelos** | `models/tenant/`: `Product` (`products`, con `unit`: ud/kg/g/l/ml/caja/paquete) · `StockEntry` (`stock_entries`) · `StockMovement` (`stock_movements`, el libro mayor: tipos `entrada`/`salida`/`ajuste`/`pedido`). |
| | Compartidos con otros módulos: `Supplier` (`suppliers`, con Gastos), `OrderLine.productId` (`order_lines`, Pedidos), `Cost` (`costs`, a través de `StockEntry.costId`), `TeamMember` (quién firma el movimiento). Asociaciones en `lib/db/tenantDb.js`, bloque `Product.hasMany(StockEntry…)`. |
| **Interruptores y parámetros** | ninguno que lea el código |
| **Pantallas propias** | ninguna (nunca las ha habido: `modules/overrides/spain-enzymes/` es solo de Leads) |
| **Scripts** | Activación: `node scripts/enable-module.js <slug> inventory` (corre `migrate-inventario-rework` —con «a», 02/08/2026— declarada en `scripts/_module-migrations.js`; necesita antes `migrate-suppliers`, que va con `billing`, porque `stock_entries.supplier_id` apunta a `suppliers`). |
| | Semilla: el catálogo genérico de las demos lo pone `scripts/seed-sandbox-data.js` (lo llaman `rebuild-demo-showcase.js` y `crear-demos-por-oficio.js`); `scripts/seed-inventario-demo.js` es un extra a mano (material de centro clínico, solo `crm_demo`, `--rehacer` para sustituir). Histórico y NO ejecutar: `scripts/_hechos/migrate-inventory-rework.js` (sin «a», rework de abril; marcado SUPERADA en el mapa `ONE_OFF` de `_module-migrations.js`). |
| **Pruebas** | ninguna: ningún `scripts/_smoke-*.mjs` toca el módulo |
| **Decisiones** | — |
| **En este doc** | Visión general · Cómo se mueve el stock · Endpoints · Pantalla · Pedidos · Migración y semilla · Si algo no cuadra · Lo que había antes (hasta el 02/08/2026) |

> Documentación de detalle del módulo. Referencia rápida en
> `CLAUDE.md` (sección "Módulos del CRM"). Si encuentras una discrepancia entre
> este documento y el código, **prevalece el código**: actualiza este fichero.

> **Rehecho entero el 02/08/2026.** Lo anterior (productos entrantes/salientes,
> recetas y alias por cliente) está descrito al final, en «Lo que había antes»,
> porque explica las cicatrices que quedan en la BD.

## Visión general

Un almacén normal: cosas que **entran** de un proveedor, están en **stock** y
**salen** vendiéndose por Pedidos o consumiéndose.

El principio de diseño es que sirva igual a un **centro clínico** y a una
**librería**. Los dos compran material, lo guardan y lo gastan; ninguno fabrica
nada.

- **Producto** (`Product`): una sola lista para lo que entra y lo que sale.
  Lo importante es `unit`: `ud` · `kg` · `g` · `l` · `ml` · `caja` · `paquete`.
  Guantes y folios se cuentan en unidades o cajas; el gel, en litros.
- **Entrada** (`StockEntry`): una recepción de mercancía, con proveedor
  (desplegable, no texto), cantidad, coste unitario y, si hace falta, lote y
  caducidad. Puede apuntar al **gasto que la pagó** (`costId` → `Cost`).
- **Movimiento** (`StockMovement`): el libro mayor. Toda variación pasa por aquí,
  con signo: positivo entra, negativo sale.

### El stock NO es una columna

```
stock(producto) = SUM(stock_movements.quantity WHERE product_id = …)
```

Deliberado. Una columna de saldo se desincroniza en cuanto una operación falla a
medias, y desde ese momento nadie sabe cuál de los dos números es la verdad.
Sumar filas indexadas por producto es barato.

El cálculo vive en `lib/inventory/stock.js` y **es el único sitio** donde se
mueve stock (`moverStock`): escribir en `stock_movements` desde fuera se salta la
validación.

### La unidad va SIEMPRE pegada a la cifra

En la UI, nunca «400» a secas: «400 unidades». Era el fallo de fondo del módulo
anterior, donde los kilos estaban **cableados en los nombres de columna**
(`kg`, `kgRemaining`) y el esquema no sabía expresar otra cosa que peso.

## Cómo se mueve el stock

| Qué pasa | Movimiento | Dónde |
| --- | --- | --- |
| Llega mercancía | `+cantidad`, tipo `entrada` | `POST /api/inventory/entries` (crea entrada **y** movimiento en la misma transacción) |
| Se completa un pedido | `−cantidad`, tipo `pedido` | `POST /api/orders/[id]/complete` |
| Rotura, caducado, recuento | `±cantidad`, tipo `ajuste` | `POST /api/inventory/stock-movements` |

**El ajuste exige motivo** y no deja dejar el stock en negativo: si falta más de
lo que hay, el dato malo es otro y hay que mirarlo, no taparlo con otro ajuste.

### Pedidos descuenta; Facturación NO

Es la regla que evita el doble descuento. Completar un pedido ya baja el stock
**y** genera su factura en borrador; si al emitir esa factura se descontara otra
vez, cada venta por el camino normal restaría el doble.

`lib/inventory/applyStockMovementsForInvoice.js` ya no descuenta: solo **avisa**
si una factura lleva productos del almacén y no viene de un pedido, para que el
desvío no pase inadvertido. No bloquea la emisión.

Antes de completar un pedido se comprueba que hay stock de todas sus líneas,
**acumulando por producto** (dos líneas de 3 del mismo producto son 6). Si falta
de algo, no se completa y se dice de qué y cuánto hay: completar a medias sería
peor que no completar.

## Endpoints

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/inventory/products` | Lista con stock calculado, aviso de bajo mínimo y categorías |
| POST | `/api/inventory/products` | Alta |
| GET/PUT/DELETE | `/api/inventory/products/[id]` | Ficha con entradas · edición · retirada |
| GET/POST | `/api/inventory/entries` | Entradas de mercancía |
| GET/POST | `/api/inventory/stock-movements` | Histórico · ajuste manual |

**Cambiar la unidad de un producto con movimientos está bloqueado** (409):
reinterpretaría el histórico, convirtiendo 400 «unidades» en 400 «kilos».

**Retirar un producto** con movimientos lo desactiva (`active = false`) en vez de
borrarlo: el histórico apunta ahí y borrarlo lo dejaría sin nombre.

### Proveedores (fuera de `/api/inventory`)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET/POST | `/api/proveedores` | Lista (`search`; solo activos salvo `incluirInactivos=1`) · alta (`409` si ya hay uno con ese nombre) |
| GET/PUT/DELETE | `/api/proveedores/[id]` | Ficha (con `totalGastado` si el tenant tiene `billing`) · edición · baja |

La puerta es **`billing` o `inventory`** a propósito: el proveedor es la misma
ficha para las dos cosas (te factura y te entrega mercancía), y un tenant que
solo tenga uno de los dos módulos debe poder mantener su lista. La baja
**desactiva** si tiene gastos o entradas colgando y borra de verdad si no tiene
nada. El desplegable de proveedor del alta de entrada lee de aquí.

### Auditoría

Los endpoints escriben en `master.AuditLog` con `inventory.entry.created`,
`inventory.product.updated`, `inventory.product.deactivated`,
`inventory.product.deleted` e `inventory.stock.adjusted`; sus frases están en
`lib/actividad/etiquetas.js` y salen en Equipo → Actividad. (Ahí siguen también
las frases de `inventory.inbound.*`, `outbound.*` y `formula.*`, para que los
registros del esquema anterior sigan leyéndose.)

## Pantalla

`/inventario` — lista con stock y unidad, filtro por categoría y por bajo
mínimo, ficha con el histórico de movimientos, alta de entrada con proveedor de
desplegable, y ajuste con motivo obligatorio.

Los proveedores se dan de alta en **Facturación → Proveedores** (`Supplier`),
que es una entidad compartida: el mismo proveedor te factura (gasto) y te
entrega mercancía (entrada de stock).

## Pedidos

`OrderLine.productId` apunta a `Product` (antes `outboundProductId`). La línea
**hereda el precio de venta del producto y es editable**: precio por defecto, no
precio impuesto — así se pacta un precio con un cliente concreto sin necesidad de
alias.

`productName` y `unitPrice` son **foto del momento**: si mañana sube el precio,
un pedido de hace un año no puede cambiar de importe.

## Migración y semilla

- `scripts/migrate-inventario-rework.js` — crea las tablas nuevas, borra las
  viejas y renombra `order_lines.outbound_product_id` → `product_id`.
  **Cuenta las filas antes de borrar y se planta** si encuentra datos en un
  schema que no sea `crm_demo` (`--forzar` para saltárselo, `--dry-run` para ver
  qué haría).
- **Activar en un tenant**: `node scripts/enable-module.js <slug> inventory`.
  La migración está declarada en `MODULES.inventory` de
  `scripts/_module-migrations.js` y va DESPUÉS de `migrate-suppliers` (bloque
  `billing`), porque `stock_entries.supplier_id` apunta a `suppliers`.
  En producción: `docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> inventory`
  (los scripts viajan dentro de la imagen).
- **Semilla de las demos**: desde el 18/08/2026 el almacén lo siembra
  `scripts/seed-sandbox-data.js` (bloque «5. INVENTARIO»: catálogo genérico,
  proveedores, entradas, salidas y un ajuste), que es lo que llaman
  `rebuild-demo-showcase.js` y `crear-demos-por-oficio.js`. Las cuatro demos
  comparten ese catálogo, y los pedidos de la demo apuntan a él.
- `scripts/seed-inventario-demo.js` — **extra opcional, a mano**: sustituye el
  catálogo genérico de `crm_demo` por material de centro clínico (varias
  unidades, algún producto bajo mínimo). Solo toca `crm_demo`; idempotente,
  `--rehacer` para borrar y volver a poner. Nadie lo llama desde el rebuild.

⚠️ `scripts/_hechos/migrate-inventory-rework.js` (sin la «a») es el rework de ABRIL y
está en `ONE_OFF`: **no se ejecuta**. Creaba justo las tablas que el nuevo
elimina, así que ejecutarlo devolvería el esquema viejo.

## Personalización por tenant

Hoy ningún tenant tiene override de UI para este módulo. El override de
`spain_enzymes` (`modules/overrides/spain-enzymes/`) toca solo Leads.

## Si algo no cuadra

- **El stock no baja al vender**: comprueba que la línea del pedido tiene
  producto (`productId`) y no es de tipo `shipping`. Las líneas de texto libre no
  consumen stock a propósito.
- **«No hay stock suficiente» y crees que sí hay**: mira si el pedido tiene
  varias líneas del mismo producto — se acumulan.
- **La factura avisa de que no se ha descontado**: es correcto si la factura no
  viene de un pedido. Descuenta desde Pedidos o con un ajuste manual.
- **No deja cambiar la unidad**: el producto ya tiene movimientos. Ajusta el
  stock a cero o crea un producto nuevo con la unidad correcta.

## Lo que había antes (hasta el 02/08/2026)

Un esquema pensado para comprar materia prima y **fabricar** otra cosa:
`InboundProduct` (materia prima) + `InboundBatch` (lotes con `kgRemaining`) +
`OutboundProduct` (lo que se vende) + `Formula` (la receta) +
`ClientOutboundAlias` (vender lo mismo con otro nombre y precio por cliente).

Se retiró porque **nadie lo usaba así**: lo pidió un cliente que al final no
contrató el módulo. Los cinco modelos y sus endpoints ya no existen.

Rastros que quedan en la BD y conviene conocer:

- `inventory_products` — tabla del esquema *anterior al anterior*. Se conserva
  como respaldo.
- `costs.inventory_product_id` — columna histórica sin asociación Sequelize.
