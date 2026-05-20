# Módulo de Inventario (`inventory`)

> Documentación de detalle del módulo. Referencia rápida en
> `CLAUDE.md` (sección "Módulos del CRM"). Si encuentras una discrepancia entre
> este documento y el código, **prevalece el código**: actualiza este fichero.

## Visión general

El módulo modela el flujo entrada → transformación → salida de materiales:

- **Producto entrante** (`InboundProduct`): catálogo de materias primas. Un
  mismo producto puede comprarse a varios proveedores y en varios lotes.
- **Lote** (`InboundBatch`): cada compra concreta a un proveedor con su fecha,
  lote, kg recibidos, kg que aún quedan y precio. El stock real de un
  producto entrante es la suma de `kgRemaining` de sus lotes.
- **Producto saliente** (`OutboundProduct`): lo que se factura al cliente.
- **Receta** (`Formula`): qué productos entrantes y en qué proporción forman
  un producto saliente. Puede ser global (sin cliente) o específica por
  cliente. Al aplicar la receta, prevalece la del cliente si existe.
- **Alias por cliente** (`ClientOutboundAlias`): un mismo producto saliente
  puede venderse con otro nombre comercial (y precio) a un cliente concreto.
- **Movimiento de stock** (`StockMovement`): histórico auditable de cada
  variación de stock. Lo escriben tanto el alta manual como el descuento
  automático que dispara la emisión de facturas.

Es un módulo opcional por tenant. Todos los endpoints validan
`hasModule("inventory")` antes de operar.

## Lo que NO hace (por ahora)

- **Reposición automática** cuando el stock baja de un umbral.
- **Reservas** (apartar stock asociado a un presupuesto antes de facturar).
- **Devolución de stock al cancelar/rectificar una factura**. Hoy `cancel` y
  `rectify` no revierten los `StockMovement` que generó el `issue`. Si hace
  falta, se ajusta a mano vía POST a `/api/inventory/stock-movements` con
  kg positivos y `reason = "adjust"`.
- **Unidades distintas de kg**. Toda la receta y el stock se modelan en
  kilogramos. No hay conversiones unidad ↔ kg ni porcentajes.
- **Alertas de stock insuficiente al editar el borrador**. Las alertas solo
  se devuelven cuando se ejecuta el descuento real (al emitir la factura).

## Modelos

Las definiciones viven en `models/tenant/`. Aquí solo se documenta lo no obvio.

### `InboundProduct` (`inbound_products`)

- `id` (UUID), `name` (string), `tags` (array de strings), `notes`.
- Sin FK directa a Client: la asociación a clientes se hace vía las recetas y
  los aliases (los clientes "consumen" productos entrantes indirectamente).
- Convención de nombre duplicado: si dos proveedores venden la misma sustancia
  pero el cliente la llama igual, se mantiene **un solo** `InboundProduct`.
  La distinción visual entre proveedores se renderiza en la UI como
  `Enzima X (Proveedor A — lote 2024-01)` a partir del campo `supplier` y
  `lot` del `InboundBatch`.

### `InboundBatch` (`inbound_batches`)

- `inboundProductId`, `supplier` (NOT NULL), `lot`, `entryDate`, `kg`,
  `kgRemaining`, `packaging`, `purchasePrice`, `notes`.
- `kg` es el total recibido. `kgRemaining` arranca igual y se decrementa
  con cada movimiento de salida. Nunca puede pasar a negativo (la UI ni la
  API permiten cantidades mayores al disponible salvo `StockMovement` con
  `kg` negativo de mayor magnitud que `kgRemaining`, que devuelve 422).
- `legacyInventoryProductId` apunta a la fila vieja de `inventory_products`
  de la que se migró. Permite ejecutar el script de migración varias veces
  sin duplicar batches. Si alguna vez se borra la tabla legacy, esta FK
  queda colgada pero no rompe nada.

### `OutboundProduct` (`outbound_products`)

- `id`, `name`, `tags`, `defaultSalePrice` (€/kg), `notes`.
- El precio puede sobreescribirse por cliente vía `ClientOutboundAlias.customSalePrice`.

### `Formula` (`formulas`)

- `outboundProductId`, `inboundProductId`, `qtyKgPerOutputKg`, `clientId`
  (nullable), `notes`.
- `qtyKgPerOutputKg` = kg de entrada por cada kg de salida producido.
  Ejemplo: receta "Tomate" con qty=0.6 sobre InboundProduct "Enzima A"
  significa que cada kg de Tomate consume 0.6 kg de Enzima A.
- `clientId NULL` = receta global. `clientId X` = receta específica del
  cliente X. El UNIQUE `(outboundProductId, inboundProductId, COALESCE(clientId, sentinel))`
  garantiza una sola receta por combinación.
  - Este UNIQUE vive en la migración SQL (`migrate-inventory-rework.js`)
    con `COALESCE` porque PostgreSQL permite múltiples NULL en columnas
    UNIQUE por defecto. El modelo Sequelize lleva un comentario aclarando
    que el unique no está declarado allí.

### `ClientOutboundAlias` (`client_outbound_aliases`)

- `outboundProductId`, `clientId`, `aliasName`, `customSalePrice`.
- UNIQUE `(outboundProductId, clientId)`.

### `StockMovement` (`stock_movements`)

- `inboundBatchId`, `kg` (negativo = salida, positivo = reposición/ajuste),
  `reason` (`sale | manual | adjust | historical`), `invoiceId`,
  `invoiceLineId`, `outboundProductId`, `clientId`, `userId`, `movedAt`, `notes`.
- `reason = "historical"` se reserva para los movimientos creados durante la
  migración desde `inventory_products` (un solo descuento por cada salida
  registrada en el modelo viejo). En adelante, la emisión de facturas usa
  `reason = "sale"` y los manuales `reason = "manual"`.

## Endpoints

Todos viven bajo `/api/inventory/` y requieren `hasModule("inventory")`.

| Método | Ruta                                                  | Función                                              |
| ------ | ----------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/inbound`                                            | Lista entrantes con stockKg agregado y proveedores   |
| POST   | `/inbound`                                            | Crea un InboundProduct (+ opcional primer lote)      |
| GET    | `/inbound/[id]`                                       | Detalle con batches, recetas que lo usan             |
| PUT    | `/inbound/[id]`                                       | Actualiza name/tags/notes                            |
| DELETE | `/inbound/[id]`                                       | 409 si tiene batches o recetas asociadas             |
| GET    | `/inbound/[id]/batches`                               | Lista de lotes del producto entrante                 |
| POST   | `/inbound/[id]/batches`                               | Añade un lote (proveedor + kg + lote + fecha)        |
| PUT    | `/inbound/[id]/batches/[batchId]`                     | Edita un lote                                        |
| DELETE | `/inbound/[id]/batches/[batchId]`                     | 409 si tiene movimientos de stock                    |
| GET    | `/outbound`                                           | Lista salientes con recetas y aliases                |
| POST   | `/outbound`                                           | Crea un OutboundProduct                              |
| GET    | `/outbound/[id]`                                      | Detalle con receta y aliases                         |
| PUT    | `/outbound/[id]`                                      | Actualiza name/tags/precio/notes                     |
| DELETE | `/outbound/[id]`                                      | 409 si tiene recetas, aliases o movimientos          |
| GET    | `/formulas?outboundProductId&inboundProductId&clientId` | Lista recetas filtradas (clientId=`null` para global) |
| POST   | `/formulas`                                           | Crea receta (409 si rompe UNIQUE)                    |
| PUT    | `/formulas/[id]`                                      | Edita cantidad/notas                                 |
| DELETE | `/formulas/[id]`                                      | Elimina la línea                                     |
| GET    | `/aliases?outboundProductId&clientId`                 | Lista aliases                                        |
| POST   | `/aliases`                                            | Crea alias (409 si ya existe para ese par)           |
| PUT    | `/aliases/[id]`                                       | Edita aliasName/customSalePrice                      |
| DELETE | `/aliases/[id]`                                       | Elimina el alias                                     |
| GET    | `/stock-movements`                                    | Histórico con filtros (batch, outbound, cliente…)    |
| POST   | `/stock-movements`                                    | Movimiento manual atómico (actualiza kgRemaining)    |
| GET    | `/stats-v2`                                           | KPIs sobre los modelos nuevos                        |

Los endpoints legacy `/api/inventory` (lista, `[id]`, `stats`, `export`)
y el modelo Sequelize `InventoryProduct` se eliminaron en esta misma
iteración. La tabla `inventory_products` permanece en BD como respaldo
hasta que se valide la migración en producción; al no haber asociación
Sequelize ya no se accede a ella desde el código.

## Flujo de descuento al emitir factura

1. La UI de facturación permite asociar cada `InvoiceLine` a un
   `OutboundProduct` vía un selector (catálogo cargado desde
   `/api/inventory/outbound` si el módulo está activo). Una línea marcada
   como **Transporte** (`kind = "shipping"`) no consume stock.
2. Al pulsar **Emitir** (`POST /api/billing/invoices/[id]/issue`), dentro
   de la misma transacción que asigna número correlativo, se llama a
   `applyStockMovementsForInvoice` (en `lib/inventory/`).
3. Para cada línea con `outboundProductId`:
   - Se buscan recetas por `(outboundProductId, clientId)`. Si no hay, se
     usa la receta global `(outboundProductId, clientId = NULL)`. Si tampoco
     hay, se emite un **warning** y se sigue.
   - Para cada componente de la receta:
     - `kgNeeded = lineQuantity × qtyKgPerOutputKg`
     - Se buscan los `InboundBatch` del componente ordenados por `entryDate`
       (FIFO) y se descuenta `kgRemaining` lote a lote.
     - Por cada batch tocado se inserta un `StockMovement` con `reason = "sale"`.
   - Si al final no había stock suficiente para cubrir `kgNeeded`, se emite
     un **warning** con los kg que faltan. La emisión **no se bloquea**.
4. La respuesta del endpoint `issue` añade un campo `inventoryWarnings: [...]`
   si hubo alguno. La UI lo muestra al usuario.

Cancelar o rectificar una factura **no devuelve** el stock — la corrección
es manual hasta que se decida la política.

## Migración desde el modelo legacy

El script `scripts/migrate-inventory-rework.js` (también `npm run db:migrate:inventory-rework`)
transforma cada fila de `inventory_products` en:

- 1 `InboundProduct` (dedupe por nombre dentro del schema).
- 1 `InboundBatch` con el `legacyInventoryProductId` rellenado.
- Si la fila tenía datos de salida: 1 `OutboundProduct` (dedupe por nombre),
  1 `Formula` con `qtyKgPerOutputKg = kg / outputKg`, y 1 `StockMovement`
  con `reason = "historical"`.

Es idempotente (se puede ejecutar varias veces; la segunda vez salta lo ya
migrado). La tabla `inventory_products` **no se borra**: queda como
respaldo hasta validar en producción.

## Personalización por tenant

Hoy ningún tenant tiene override de UI para este módulo. El override de
`spain_enzymes` (`modules/overrides/spain-enzymes/`) toca solo Leads.

## Skip list rápido si algo no cuadra

- **Stock no se descuenta al emitir**: el módulo `inventory` debe estar
  activo en el tenant; la línea debe llevar `outboundProductId`. Línea de
  texto libre o `kind = "shipping"` no consume stock.
- **Receta no encontrada**: revisa que haya receta para el cliente actual o
  una receta global como fallback. La UI del producto saliente las muestra
  separadas.
- **Stock insuficiente**: aparece en `inventoryWarnings` de la respuesta del
  endpoint `issue`. Añade un lote nuevo o ajusta con un `StockMovement`
  manual positivo.
- **UNIQUE rota al crear receta**: significa que ya existe una receta para
  el mismo `(outboundProductId, inboundProductId, clientId)`. Edita la
  existente en vez de crear otra.
