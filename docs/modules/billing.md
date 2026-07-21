# Módulo de Facturación (`billing`)

> Documentación de detalle del módulo. Referencia rápida en
> `CLAUDE.md` (sección "Módulos del CRM"). Si encuentras una discrepancia entre
> este documento y el código, **prevalece el código**: actualiza este fichero.

## Visión general

El módulo cubre el ciclo financiero del tenant:

- Emisión de facturas (borrador → emitida → enviada → cobrada / parcial / vencida).
- Cobros parciales asociados a una factura.
- Costes con IVA (deducible o no), por categoría (fijo / variable / OPEX / CAPEX).
- Facturación recurrente (plantillas, **emisión manual hoy**).
- Libro de IVA + estimación del Modelo 303 con exportación a Excel.
- Analítica por cliente y por empleado (sobre base imponible).
- Configuración fiscal del emisor y series de facturación correlativas.

Es un módulo opcional por tenant. Todos los endpoints validan
`hasModule("billing")` antes de operar.

## Lo que NO hace (por ahora)

- **Catálogo de productos / servicios** reutilizables. Cada línea de factura
  se escribe a mano.
- **Verifactu / Facturantia**: los campos `facturantiaId`, `qrUrl`,
  `verifactuStatus`, `verifactuSentAt` existen en `Invoice` pero **no se rellenan
  ni hay integración** (ni QR, ni hash, ni envío a la AEAT). El PDF NO es un
  documento conforme al sistema antifraude. Pendiente (masterclass Quique, ago-2026).
- **Motor de ejecución automática de RecurringInvoice**: hoy son plantillas
  con `nextRunAt` orientativa. La emisión real es manual (vía POST al
  endpoint, restringido a admin, o creando una factura nueva). Pendiente
  integrar con n8n.
- **Integración Inventario ↔ Costes**: `Cost.inventoryProductId` está en BD y
  asociado en Sequelize, pero no hay endpoints ni UI que lo usen. FK durmiente.

## Ya implementado (correcciones de doc previa)

Cosas que versiones antiguas de este doc daban por NO hechas y **sí existen**:

- **PDF de la factura** (`lib/billing/invoicePdf.js`): individual y en ZIP por
  rango; muestra desglose de IVA, IRPF, notas y pie. No lleva QR/Verifactu.
- **Presupuestos** convertibles a factura (`/api/billing/quotes/[id]/convert`).
- **IRPF** por factura y **rectificativas** con edición de importe (parcial por
  diferencias / anulación total).

## Configuración fiscal (sprint 2026-07-21)

`TenantBillingSettings` guarda la config fiscal del emisor. Novedades:

- **Régimen fiscal (`taxRegime`: `company` | `freelance`)** e **IRPF por defecto 0**.
  Antes `defaultIrpfRate` era 15 y restaba IRPF a TODA factura (mal en SL y B2C).
  Ahora por defecto 0; solo se aplica si el emisor se marca **Autónomo profesional**
  (interruptor en Configuración → Facturación). Migración
  `migrate-billing-tax-regime.js` (resetea el 15 heredado). El cálculo
  (`invoices/route.js`) defaultea a 0.
- **Exención general de IVA (`vatExempt` + `vatExemptNote`)**. Con el interruptor
  activo, las nuevas facturas nacen a **IVA 0** y **congelan la nota legal** (art.20
  LIVA, editable) en `invoice.customFields.vatExemptNote`, que el PDF muestra.
  Migración `migrate-billing-vat-exempt.js`. Para exención por-servicio puntual se
  pone la línea a 0% en el editor.
- **Numeración en orden de fecha**: `assignInvoiceNumber` bloquea emitir una factura
  con fecha anterior a la última ya emitida de esa serie+año (error 422). Garantiza
  correlatividad cronológica además de numérica.
- **Reparto de cuota del paciente en 2 modos** (`components/billing/PatientReparto.jsx`):
  A) una factura por el total a un pagador (IVA una vez + cobros parciales), y
  B) varias facturas (una por pagador, IVA proporcional) con **validación de que la
  suma cuadre** con el total y limpieza de borradores si algo falla a medias.

## Modelos

Las definiciones viven en `models/tenant/`. Aquí solo se documenta lo no obvio.

### Invoice

Fichero: `models/tenant/Invoice.model.js`. Tabla: `invoices`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID NOT NULL | Cliente facturado (FK a `Client`). |
| `employeeId` | UUID nullable | Empleado responsable (FK a `TeamMember`). |
| `series` | VARCHAR(8) | Código de serie (`F` ordinaria, `R` rectificativa). |
| `number` | STRING UNIQUE | `DRAFT-…` mientras es borrador; `F-YYYY-NNNN` al emitir. |
| `status` | ENUM | `draft`, `issued`, `sent`, `paid`, `partially_paid`, `overdue`, `cancelled`, `rectified`. |
| `issueDate` | DATEONLY NOT NULL | Fecha de emisión (define el periodo fiscal). |
| `dueDate` | DATEONLY nullable | Se prerellena con `issueDate + TenantBillingSettings.defaultPaymentTermsDays` al crear el borrador y al emitir, si no llega explícito. |
| `lines` | JSONB | Estructura nueva con IVA por línea. Ver sección dedicada. |
| `taxBase` | DECIMAL(12,2) | Suma de `lineBase`. **Es la magnitud financiera real**. |
| `vatAmount` | DECIMAL(12,2) | Suma de `lineVat`. |
| `total` | DECIMAL(12,2) | `taxBase + vatAmount`. |
| `paidAmount` | DECIMAL(12,2) | Cache: SUM de `Payment.amount` con `status='completed'`. Lo recalcula `updateInvoiceStatus`. |
| `rectifiesInvoiceId` | UUID nullable | Si esta factura es rectificativa, apunta a la original. |
| `rectifiedByInvoiceId` | UUID nullable | En la original, apunta a su rectificativa cuando ya fue rectificada. |
| `recurringConfig` | JSONB | Si nació de una RecurringInvoice, guarda `{ recurringInvoiceId }`. |
| `customFields` | JSONB | Extensión libre. |

Campos legacy (no tocar, pendiente de limpieza en sprint posterior):
`familyId`, `patientId`, `serviceType`, `invoiceType`, `subtotal`, `vatRate`,
`discountType`, `discountValue`. Vienen del modelo terapéutico anterior. El
código nuevo los rellena con valores neutros (`subtotal = taxBase`,
`vatRate = 0`) para mantener compatibilidad de datos antiguos.

Asociaciones (definidas en `lib/db/tenantDb.js`):

- `Invoice.belongsTo(Client, as: "client")`.
- `Invoice.hasMany(Payment, as: "payments")`.
- `Invoice.belongsTo(TeamMember, as: "employee")`.
- Self-relations: `belongsTo(Invoice, as: "rectifies")` y
  `belongsTo(Invoice, as: "rectifiedBy")`.

### Cost

Fichero: `models/tenant/Cost.model.js`. Tabla: `costs`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `type` | ENUM | `salary`, `rent`, `software`, `material`, `commission`, `other`. |
| `category` | ENUM | `fixed`, `variable`, `capex`, `opex`. |
| `description` | STRING NOT NULL | Texto libre. |
| `taxBase` | DECIMAL(12,2) | Magnitud usada en márgenes y EBITDA. |
| `vatRate` | DECIMAL(5,2) | Default `21`. |
| `taxAmount` | DECIMAL(12,2) | `taxBase × vatRate / 100` recalculado en POST/PATCH. |
| `total` | DECIMAL(12,2) | `taxBase + taxAmount`. |
| `vatDeductible` | BOOLEAN | Si `true`, contribuye a IVA soportado del Modelo 303. |
| `incurredAt` | DATEONLY NOT NULL | Fecha real del gasto. Filtra por periodo. |
| `employeeId` | UUID nullable | FK a `TeamMember` (quien lo registró o a quien se imputa). |
| `clientId` | UUID nullable | FK a `Client` para imputar costes a un cliente concreto. |
| `inventoryProductId` | UUID nullable | **Durmiente**: sin endpoints ni UI. |
| `attachmentUrl` | STRING nullable | URL del justificante. |

Campos durmientes en BD pero no expuestos en el modelo Sequelize (legacy del
seed antiguo, pendientes de borrado físico):

- `month` (VARCHAR YYYY-MM): la migración la pasó a `NULL` permitido.
- `amount` (DECIMAL): la migración hizo backfill `taxBase = amount` y la pasó
  a `NULL` permitido.

Asociaciones:

- `Cost.belongsTo(TeamMember, as: "employee")`.
- `Cost.belongsTo(Client, as: "client")`.
- Columna `Cost.inventoryProductId` sigue en BD pero **sin asociación
  Sequelize**: el modelo `InventoryProduct` se retiró con el rework de
  Inventario. Pendiente decidir si se elimina o se re-apunta a
  `OutboundProduct`.

### Payment

Fichero: `models/tenant/Payment.model.js`. Tabla: `payments`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `invoiceId` | UUID NOT NULL | FK a `Invoice`. |
| `amount` | DECIMAL(12,2) | Importe del cobro. Se valida que no exceda `total - paidAmount`. |
| `paidAt` | DATE NOT NULL | Fecha del cobro (no del periodo de la factura). |
| `method` | ENUM | `card`, `transfer`, `cash`, `direct_debit`. |
| `status` | ENUM | `pending`, `completed`, `failed`, `refunded`. Default `completed`. |
| `notes` | TEXT nullable | |

Solo los pagos con `status = "completed"` cuentan en `paidAmount` y disparan
transición de la factura.

Asociación: `Payment.belongsTo(Invoice, as: "invoice")`.

### RecurringInvoice

Fichero: `models/tenant/RecurringInvoice.model.js`. Tabla: `recurring_invoices`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID NOT NULL | |
| `familyId` | UUID nullable | Legacy del dominio terapéutico. |
| `frequency` | ENUM | `weekly`, `biweekly`, `monthly`. |
| `nextRunAt` | DATE NOT NULL | Próxima fecha sugerida. **Hoy solo orientativa**. |
| `templateConfig` | JSONB | Plantilla de la factura: `{ description, taxBase, vatRate, lines?, notes? }`. |
| `active` | BOOLEAN | Pausa/activa la recurrencia. |

POST a `/api/billing/recurring/[id]` genera un **borrador** a partir de la
plantilla y avanza `nextRunAt` según la frecuencia. No emite ni asigna
número correlativo. El usuario tiene que ir a Facturas y pulsar "Emitir".

Asociación: `RecurringInvoice.belongsTo(Client, as: "client")`.

### InvoiceSeries

Fichero: `models/tenant/InvoiceSeries.model.js`. Tabla: `invoice_series`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `code` | VARCHAR(8) UNIQUE | Identificador corto (`F`, `R`). |
| `name` | STRING | Nombre legible. |
| `prefix` | VARCHAR(16) | Prefijo del número final. Por defecto coincide con `code`. |
| `year` | INTEGER | Año de la numeración. Si cambia, se reinicia. |
| `nextNumber` | INTEGER | Próximo número correlativo. Lock pesimista al asignar. |
| `isDefault` | BOOLEAN | Solo informativo en la UI. |
| `kind` | ENUM | `normal` o `rectificative`. |

La migración crea siempre dos series por tenant: `F` (default, `normal`) y
`R` (`rectificative`). El endpoint `PATCH /series/[id]` **no permite editar
`nextNumber`** para no romper la correlatividad fiscal. `DELETE` rechaza
si hay facturas con esa serie.

### TenantBillingSettings

Fichero: `models/tenant/TenantBillingSettings.model.js`. Tabla:
`tenant_billing_settings`. Una sola fila por tenant.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `fiscalName`, `taxId`, `fiscalAddress`, `fiscalCity`, `fiscalZip` | STRING nullable | Datos fiscales del **emisor**. |
| `fiscalCountry` | VARCHAR(2) | Default `ES`. |
| `defaultVatRate` | DECIMAL(5,2) | Default `21`. Aplicado a las nuevas líneas que no traigan `vatRate`. |
| `availableVatRates` | JSONB | Array de números 0-100. Default `[21, 10, 4, 0]`. La UI usa esta lista en los desplegables. |
| `defaultPaymentTermsDays` | INTEGER | Default `30`. Se aplica automáticamente como `dueDate = issueDate + N días` cuando POST `/invoices` no incluye `dueDate`, y al emitir un borrador que aún no lo tenga. La UI también lo prerellena. |
| `invoiceFooterText`, `logoUrl` | nullable | Branding del documento. |

### Modelos relacionados

- `TeamMember.monthlySalary` (DECIMAL(10,2) nullable): salario mensual.
  **Solo informativo**. NO se cuenta como coste real (eso lo hace la tabla
  `Cost` con `type='salary'`). Filtrado en backend: solo admin/superadmin
  lo ve. Se usa para el KPI `projectedSalaryCost` (proyección estimativa).
- `TeamMember.hourlyCost` y `hourlyRate`: legacy de tarificación por hora,
  no se usan en los KPIs actuales.
- `Client.fiscalName`, `fiscalAddress`, `fiscalCity`, `fiscalZip`,
  `fiscalCountry`: campos fiscales del **destinatario**, opcionales en el
  modelo. Bloqueantes para emitir factura: ver "Validaciones críticas".

## Estructura de líneas de factura

`Invoice.lines` es un array JSONB. Cada línea tiene este esquema (lo computa
`lib/billing/calculateInvoice.js`):

```json
{
  "description": "Consultoría estratégica",
  "quantity": 1,
  "unitPrice": 1800,
  "discountPct": 0,
  "vatRate": 21,
  "lineBase": 1800.00,
  "lineVat": 378.00,
  "lineTotal": 2178.00
}
```

Reglas:

- Cantidades negativas son válidas (se usan en rectificativas).
- `lineBase = round2(quantity × unitPrice × (1 - discountPct/100))`.
- `lineVat = round2(lineBase × vatRate/100)`.
- `lineTotal = round2(lineBase + lineVat)`.
- Cada línea se redondea a 2 decimales **antes de sumar**: evita drift de
  céntimos entre la suma de líneas y los totales de la factura.

`calculateInvoice` también devuelve un agregado `vatBreakdown` por tipo de
IVA (`{ "21": { base, vat }, "10": { base, vat } }`) que se usa para pintar
el desglose en el drawer de la factura.

## Estados de factura y transiciones

```
              POST /invoices                  POST /invoices/:id/issue
   (nada) ──────────────────► draft ──────────────────────────► issued
                              │  │                                │
                              │  │ DELETE /invoices/:id           │ POST /invoices/:id/send
                              │  └──► (borrada)                   ▼
                              │                                  sent
                              │                                   │
              POST /invoices/:id/cancel                           │
              (solo si paidAmount = 0)                            ▼
   draft / issued / sent ─────────────────────► cancelled    paid / partially_paid / overdue
                                                                  │
                                                                  │ POST /invoices/:id/rectify
                                                                  ▼
                                                              rectified  + (nueva R-…)
```

Quién dispara cada transición:

- **`draft` → `issued`**: `POST /api/billing/invoices/[id]/issue`. Asigna
  número correlativo en transacción con `FOR UPDATE`. Rechaza con `422` si
  el cliente no tiene `fiscalName`/`name` o `taxId`. Rechaza con `400` si
  no hay líneas o `total <= 0`. Solo admin/superadmin.
- **`issued` → `sent`**: `POST /api/billing/invoices/[id]/send`. Solo
  permitido si el estado actual es `issued`; rechaza con `422` en cualquier
  otro caso. Solo admin/superadmin. Acepta `?via=email|whatsapp|other` como
  anotación informativa (se persiste en `customFields.sentVia`/`sentAt`).
  La distinción `issued` vs `sent` es informativa: **no afecta a ningún
  cálculo de KPI**. También se usa como destino de revertido desde
  `paid`/`partially_paid` cuando desaparecen los cobros (ver
  `updateInvoiceStatus.js`).
- **`issued`/`sent` → `paid` / `partially_paid`**: indirecto. Al crear o
  actualizar `Payment`, `updateInvoiceStatus` recalcula `paidAmount` y
  ajusta el estado.
- **`overdue`**: se calcula **dinámicamente en lectura** (no se persiste).
  El helper `lib/billing/invoiceStatus.js` (`effectiveStatus`) reescribe
  el `status` que se serializa hacia el cliente: si la factura está en
  `issued`/`sent`/`partially_paid` y `dueDate < hoy` y `paidAmount < total`,
  el campo `status` devuelto es `overdue`. La fila en BD no se modifica.
  Si un admin setea `overdue` manualmente vía PATCH (caso típico:
  reclamación abierta), prevalece sobre el cálculo. Esto evita la
  necesidad de un cron y elimina riesgos de desincronización.
- **`draft`/`issued`/`sent` → `cancelled`**: `POST /invoices/[id]/cancel`.
  `409` si `paidAmount > 0` (refunde primero o emite rectificativa). Solo
  admin/superadmin.
- **`issued`/`sent`/`paid`/`partially_paid`/`overdue` → `rectified`**:
  `POST /invoices/[id]/rectify`. Crea una factura nueva en serie `R` con
  cantidades invertidas (negativas), la marca `issued`, enlaza ambas
  (`rectifiesInvoiceId` ↔ `rectifiedByInvoiceId`) y deja la original como
  `rectified`. Rechaza si ya hay `rectifiedByInvoiceId`. Solo admin/superadmin.
- **`draft` → eliminable**: `DELETE /api/billing/invoices/[id]` (`409` si
  no es draft). Solo admin/superadmin.

`PATCH /invoices/[id]` solo acepta cambios cuando el estado es `draft`.
Para cualquier modificación posterior se usa rectificativa.

## Lógica de cálculos KPI

Toda la lógica vive en `lib/billing/billingSummary.js`. Principio rector:

> **Todos los KPIs financieros del Resumen están en BASE IMPONIBLE (sin IVA).**
> El IVA es dinero que pasa por la empresa pero no es suyo. Los reportes que
> sí lo cuentan son el Libro IVA y el Modelo 303 (otra función,
> `buildIvaReport.js`).

Filtros base de "facturas activas del periodo":

- `issueDate BETWEEN from AND to`
- `status NOT IN ('draft', 'cancelled', 'rectified')`

### Facturado

```
billedBase = SUM(invoices.tax_base)   (sobre facturas activas)
```

### Cobrado

Cobrado proporcional en base imponible. Cada factura aporta su parte cobrada
**proporcional al peso de la base sobre el total con IVA**:

```
collectedBase = SUM( paid_amount × tax_base / NULLIF(total, 0) )
```

`NULLIF` evita división por cero en facturas con `total = 0`. Esto reparte
correctamente el IVA pagado fuera del importe operativo y elimina el bug
histórico que producía `Cobrado / Facturado > 100 %`.

### Pendiente

```
pendingCollection = max(0, billedBase - collectedBase)
```

Siempre `≥ 0` por construcción.

### Conteos

- `invoiceCount`: nº de facturas activas del periodo (todas).
- `clientCount`: clientes únicos de las facturas activas del periodo.
- `pendingInvoiceCount`: nº de facturas activas del periodo con
  `paid_amount < total`.
- `pendingClientCount`: clientes únicos de las pendientes (no de todas).

### Ticket medio

```
averageTicket = invoiceCount > 0 ? billedBase / invoiceCount : 0
```

Sobre base imponible.

### Costes

Sobre `Cost.taxBase` filtrado por `incurredAt BETWEEN from AND to`. Se agrupa
por `category` y por `type`.

```
totalCosts     = sum(costs.tax_base)
operatingCosts = costs.byCategory.variable
               + costs.byCategory.fixed
               + costs.byCategory.opex
```

CAPEX está fuera de operativos por definición (es inversión, no gasto del
periodo).

### Márgenes

```
grossMargin = billedBase - costs.byCategory.variable
netMargin   = billedBase - operatingCosts
ebitda      = netMargin + costs.byCategory.capex
```

EBITDA suma el CAPEX al Margen Neto porque el CAPEX no es coste operativo.
Los porcentajes correspondientes se calculan sobre `billedBase`.

### `monthsBetween`

Para `projectedSalaryCost` (analítica de empleados):

```
days = (to - from) / (1000*60*60*24)
months = max(0, round2(days / 30.4375))
```

Sin `+1` inclusivo. Un periodo de 1 año natural devuelve ≈ 12.0 meses, no 13.

### Bugs históricos que NO se deben reintroducir

Antes del rework, los siguientes bugs estaban en producción y han sido
corregidos. Si vuelves a tocar `billingSummary.js`, no rompas estos invariantes:

1. **Cobrado superior a 100 % del Facturado** — venía de sumar `paid_amount`
   con IVA contra `tax_base` sin IVA. Solución: distribución proporcional con
   `paid_amount × tax_base / total`.
2. **EBITDA igual al Margen Neto** — antes no se sumaba el CAPEX. Solución:
   `ebitda = netMargin + capex`.
3. **Pendiente contado sobre todas las facturas** — antes el conteo de
   "facturas pendientes" era el total de facturas del periodo. Solución:
   filtro adicional `paidAmount < total`.
4. **Mezcla de unidades** — algunos KPIs venían con IVA y otros sin él.
   Solución: TODO el Resumen va sobre `taxBase`. Solo `billedTotal` se
   mantiene como dato informativo.
5. **`projectedSalaryCost` inflado ~8 %** — la fórmula inclusiva
   `(y2-y1)*12 + (m2-m1) + 1` daba 13 meses para un año. Solución: días/30.4375.
6. **Cobrado/Facturado > 100 % al rectificar facturas cobradas** — el filtro
   `status NOT IN (..., 'rectified')` excluía la original (perdiendo su
   `paid_amount` del `collectedBase`) mientras la R con base negativa restaba
   del `billedBase` sin compensar el cobrado (R recién creada con
   `paid_amount=0`). Resultado: ratio > 100 %. **Solución** (2026-05): en
   `POST /api/billing/invoices/[id]/rectify` la R hereda
   `paidAmount = -original.paidAmount` al crearse. Así el cobrado virtual de
   la R compensa exactamente el cobrado perdido al excluir la original. Para
   tenants con R existentes anteriores al fix, ejecutar el backfill SQL:
   `UPDATE crm_${slug}.invoices r SET paid_amount = -f.paid_amount FROM
   crm_${slug}.invoices f WHERE r.rectifies_invoice_id = f.id AND
   r.paid_amount = 0`.

## Numeración correlativa

Implementado en `lib/billing/generateInvoiceNumber.js`
(`assignInvoiceNumber`).

- El número solo se asigna al **emitir** (draft → issued). El borrador no
  consume número.
- Se ejecuta dentro de una transacción explícita con `SELECT ... FOR UPDATE`
  sobre la fila de `InvoiceSeries`. La fila queda bloqueada hasta el commit,
  garantizando unicidad.
- Si la fecha de emisión cae en un año distinto al de la serie, se calcula
  el siguiente `nextNumber` consultando el `MAX` real para ese prefijo+año en
  `invoices`. Evita colisiones con datos históricos importados.
- Formato: `${prefix}-${year}-${NNNN}` (4 dígitos con padding). Ejemplo:
  `F-2026-0042`.
- Hay dos series por tenant garantizadas por la migración: `F` (`normal`) y
  `R` (`rectificative`). El endpoint de `POST /series` permite crear más
  desde admin, pero la UI de configuración solo lista las existentes.

La correlatividad sin huecos es **obligación fiscal**. Por eso:

- No se permite borrar facturas emitidas (solo borradores).
- `PATCH /series/[id]` no acepta cambios en `nextNumber`.
- Para anular una factura emitida con cobros se rectifica, no se cancela.

## IVA por línea

`calculateInvoice` procesa cada línea con su propio `vatRate`. Los tipos
disponibles para los desplegables vienen de `TenantBillingSettings.availableVatRates`
(default `[21, 10, 4, 0]`, editable en `/facturacion/configuracion`).

El breakdown agregado por tipo (`vatBreakdown` en la respuesta de
`calculateInvoice`) se usa para pintar "IVA 21%: 378,00 €" / "IVA 4%: 18,00 €"
en el drawer de la factura y en el formulario de creación.

Redondeo: cada línea se redondea a 2 decimales **antes de sumar**, evitando
drift entre la suma de líneas y los totales agregados.

## Libro IVA y Modelo 303

`lib/billing/buildIvaReport.js` agrega los datos. El endpoint
`/api/billing/analytics/iva` devuelve la estructura JSON; el endpoint
`/api/billing/analytics/iva/export` devuelve un Excel con tres hojas (IVA
Repercutido, IVA Soportado, Modelo 303) generado con `exceljs`.

Composición:

- **IVA repercutido** (ventas): se calcula desde `Invoice.lines` (no desde
  `vatAmount`) agrupando por `vatRate`. Solo facturas con
  `status NOT IN (draft, cancelled, rectified)` y `issueDate` en el periodo.
- **IVA soportado deducible** (compras): `Cost.taxAmount` solo cuando
  `vatDeductible = true` y `taxAmount > 0`. Filtrado por `incurredAt`.
- **Modelo 303** (estimativo):
  ```
  outputVat              = SUM(IVA repercutido)
  deductibleInputVat     = SUM(IVA soportado deducible)
  difference             = outputVat - deductibleInputVat
  ```
  - `difference > 0` → "A pagar a Hacienda".
  - `difference < 0` → "A devolver / compensar".

> **Aviso obligatorio**: el Modelo 303 que devuelve este módulo es
> **estimativo / orientativo**. No es la declaración real ante la AEAT. La
> UI de `/facturacion/analitica/iva` muestra el aviso en una banda ámbar.

**Backfill conservador**: la migración `migrate-billing-rework.js` rellenó
los costes históricos previos al rework con `vat_rate = 0`,
`vat_deductible = false` y `tax_base = amount`. Esto significa que el
Libro IVA es fiable solo para los costes posteriores a la migración, o para
los que se hayan editado a mano. Para los más antiguos no se infiere IVA que
no estaba registrado.

## Filtrado de campos sensibles

El filtrado se hace **siempre en backend antes de serializar** la respuesta,
nunca confiando en que el frontend respete el rol.

- `TeamMember.monthlySalary` y `TeamMember.hourlyCost`: solo
  admin/superadmin (controlado en los endpoints de `/api/team`, fuera de
  este módulo, pero mencionado aquí porque alimenta los KPIs).
- `/api/team/[id]/billing-summary`: si el viewer no es admin, se borran
  `data.employee.monthlySalary` y `data.projectedSalaryCost` antes de
  devolver.
- `/api/billing/analytics/employees`: `monthlySalary` y `projectedSalaryCost`
  solo se incluyen en el JSON cuando el rol es admin/superadmin. La whitelist
  de `sortBy` también excluye estos campos para no-admins.

## Validaciones críticas

- **Emisión bloqueada (HTTP 422)** si el cliente carece de
  `fiscalName`/`name` o `taxId`. Mensaje explícito indicando qué falta y
  enlace a la ficha del cliente desde la UI.
- **Borrado de cliente bloqueado (HTTP 409)** si tiene al menos una
  factura. Implementado en `app/api/clients/[id]/route.js` (DELETE). El
  mensaje sugiere marcar el cliente como inactivo.
- **PATCH de factura solo en `draft`** (HTTP 409 en otros estados). Permitido
  cambiar: `clientId`, `employeeId`, `issueDate`, `dueDate`, `lines`,
  `notes`, `customFields`, `series`. Si llegan `lines`, se recalculan
  `taxBase`, `vatAmount`, `total`.
- **POST de cobro** rechaza facturas en `draft`/`cancelled`/`rectified`
  (HTTP 409) y rechaza importes que excedan el pendiente (HTTP 400, con
  margen de redondeo de 0.0049).
- **Cancelación con cobros** prohibida (HTTP 409). Hay que reembolsar
  primero o rectificar.
- **Rectificativa**: líneas con `quantity` invertida (negativa). La suma neta
  de la factura R cancela aritméticamente la original. La original queda
  `rectified` y la R en `issued`.

## Integraciones con otros módulos

### Clientes (#1)

- Nuevos campos fiscales en `Client`: `fiscalName`, `fiscalAddress`,
  `fiscalCity`, `fiscalZip`, `fiscalCountry` (default `ES`).
- Endpoint cross-module: `GET /api/clients/[id]/billing-summary?from=&to=`
  (sin `from`/`to` → histórico completo).
- Sección embebida `components/billing/ClientBillingSection.jsx` en la ficha
  de cliente: stats (Facturado, Cobrado, Pendiente, Margen) + listado de las
  10 últimas facturas del cliente. Si el módulo billing no está activo, el
  endpoint devuelve `403` y la sección no se renderiza (silenciosa).
- En el alta/edición de factura, si el cliente seleccionado no tiene
  `fiscalName` o `taxId`, aparece una banda ámbar con enlace a la ficha del
  cliente. Permite guardar como borrador, pero no emitir.

### Equipo (#6)

- `Invoice.employeeId` y `Cost.employeeId` (FK a `TeamMember`).
- `TeamMember.monthlySalary` (informativo, solo admin).
- Endpoint cross-module:
  `GET /api/team/[id]/billing-summary?from=&to=`. Devuelve facturado,
  ticket medio, coste salarial registrado, y `projectedSalaryCost` (solo
  admin).
- Sección embebida `components/billing/EmployeeBillingSection.jsx` en el
  drawer de la página de Equipo. Selector trimestre/año.

### Inventario (#10)

- Conexión Invoice ↔ Inventario implementada: al emitir factura, las líneas
  con `outboundProductId` disparan el descuento FIFO sobre `InboundBatch`
  vía `lib/inventory/applyStockMovementsForInvoice.js`. Líneas con
  `kind = "shipping"` (transporte) no consumen stock. Detalle en
  `docs/modules/inventory.md`.
- `Cost.inventoryProductId` queda como columna histórica sin asociación
  Sequelize. Pendiente decidir si se elimina o se re-apunta al nuevo
  modelo.

## Endpoints

Todos bajo `/api/billing/` salvo los marcados como cross-module. Todos
pasan por `withTenant` y validan `hasModule("billing")`.

### Invoices

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /invoices` | Listado paginado con filtros (`status`, `clientId`, `employeeId`, `series`, `from`, `to`, `q`) y orden whitelisted. | — |
| `POST /invoices` | Crea borrador (sin número, sin emitir). Aplica `defaultVatRate` a líneas sin `vatRate`. | — |
| `GET /invoices/[id]` | Detalle con `payments`, `client`, `employee`, `rectifies`, `rectifiedBy`. | — |
| `PATCH /invoices/[id]` | Edita un borrador. Recalcula totales si cambian las líneas. | Solo admin/superadmin. |
| `DELETE /invoices/[id]` | Borra borrador (`409` si no es draft). | Solo admin/superadmin. |
| `POST /invoices/[id]/issue` | draft → issued con número correlativo en transacción. Aplica `dueDate` por defecto si el borrador no lo tenía. | Solo admin/superadmin. |
| `POST /invoices/[id]/send` | issued → sent (informativo). `?via=email\|whatsapp\|other` como anotación opcional. `422` si el estado no es `issued`. | Solo admin/superadmin. |
| `POST /invoices/[id]/cancel` | issued/sent → cancelled (`409` si tiene cobros). | Solo admin/superadmin. |
| `POST /invoices/[id]/rectify` | Crea factura R-, marca la original como `rectified`. | Solo admin/superadmin. |

Las acciones `issue`, `send`, `cancel`, `rectify` registran en
`master.AuditLog` con la acción correspondiente.

Las respuestas de estos endpoints (incluido el GET) reescriben el `status`
con `effectiveStatus` (ver "Estados y transiciones": cálculo dinámico de
`overdue`). El campo persistido en BD no cambia salvo en transiciones
explícitas.

### Costs

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /costs` | Listado con filtros (`type`, `category`, `employeeId`, `clientId`, `from`, `to`) y orden whitelisted. | — |
| `POST /costs` | Crea coste; recalcula `taxAmount`/`total` desde `taxBase × vatRate`. Si no se indica `employeeId`, usa el `TeamMember` cuyo `userId` coincide con el del solicitante. | — |
| `GET /costs/[id]` | Detalle con `employee` y `client`. | — |
| `PATCH /costs/[id]` | Edita y recalcula totales si cambian `taxBase`/`vatRate`. | Solo admin/superadmin. |
| `DELETE /costs/[id]` | Borra. | Solo admin/superadmin. |

### Payments

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /payments` | Listado paginado con filtros (`invoiceId`, `status`, `method`, `from`, `to`) y orden whitelisted. | — |
| `POST /payments` | Registra cobro y dispara `updateInvoiceStatus`. Rechaza si excede el pendiente. | Solo admin/superadmin. |
| `GET /payments/[id]` | Detalle con `invoice`. | — |
| `PATCH /payments/[id]` | Cambia `status`/`amount`/`method`/`paidAt`/`notes` y recalcula la factura. | Solo admin/superadmin. |
| `DELETE /payments/[id]` | Borra y recalcula la factura. | Solo admin/superadmin. |

### Series

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /series` | Lista todas, ordenadas por `isDefault`/`code`. | — |
| `POST /series` | Crea serie nueva. Valida `code` (`^[A-Z0-9]{1,8}$`) y `year`. | Solo admin/superadmin. |
| `PATCH /series/[id]` | Cambia `name`, `prefix`, `isDefault`. **No permite editar `nextNumber`**. | Solo admin/superadmin. |
| `DELETE /series/[id]` | Borra serie. `409` si hay facturas usándola. | Solo admin/superadmin. |

### Settings

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /settings` | Devuelve la fila única (la crea vacía si no existe). | — |
| `PUT /settings` | Actualiza datos fiscales, IVA, términos de pago, branding. Valida `availableVatRates` como array de números 0-100. | Solo admin/superadmin. |

### Recurring

Todos los endpoints validan `hasModule("billing")`. Las mutaciones requieren
admin/superadmin.

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /recurring` | Lista con filtros `active`, `clientId` y orden whitelisted. | — |
| `POST /recurring` | Crea recurrencia. | Solo admin/superadmin. |
| `GET /recurring/[id]` | Detalle. | — |
| `PATCH /recurring/[id]` | Activa/desactiva, cambia frecuencia/`nextRunAt`/template. | Solo admin/superadmin. |
| `POST /recurring/[id]` | Genera **un borrador** desde el template y avanza `nextRunAt`. | Solo admin/superadmin. |
| `DELETE /recurring/[id]` | Borra recurrencia. | Solo admin/superadmin. |

### Analytics

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /analytics?from=&to=` | KPIs del Resumen (ingresos, costes, márgenes, evolución mensual). | `from` y `to` obligatorios. |
| `GET /analytics/iva?from=&to=` | Libro IVA + estimación Modelo 303. | `from` y `to` obligatorios. |
| `GET /analytics/iva/export?from=&to=` | Excel con 3 hojas (xlsx). | — |
| `GET /analytics/clients?from=&to=&sortBy=&sortDir=` | Por cliente: facturado/cobrado/pendiente/margen sobre base imponible. | — |
| `GET /analytics/employees?from=&to=&sortBy=&sortDir=` | Por empleado: facturado, coste salarial, margen, cancelaciones. `monthlySalary` y `projectedSalaryCost` solo admin. | — |

### Cross-module summaries

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/clients/[id]/billing-summary?from=&to=` | Resumen del cliente (sin periodo → histórico). Usa `getClientBillingSummary`. | Requiere `hasModule("billing")`. |
| `GET /api/team/[id]/billing-summary?from=&to=` | Resumen del empleado. Filtrado por rol. Usa `getEmployeeBillingSummary`. | Requiere `hasModule("team")` o `hasModule("billing")`. |

### Rates (legacy)

`GET /POST /PATCH /DELETE /api/billing/rates[/...]` y `lib/billing/getApplicableRate.js`
quedan como sub-módulo legacy de tarifas por empleado del flujo terapéutico
antiguo. El rework billing usa precio explícito en cada línea de factura.
**No es un punto de extensión recomendado**. Aún así, todos los endpoints
validan `hasModule("billing")` y las mutaciones requieren admin/superadmin
(igualados con el resto del módulo).

## Páginas frontend

Todas bajo `app/(dashboard)/facturacion/`. Componentes compartidos en
`_components/`: `PeriodPicker`, `StatusBadge`, `Kpi`, `tableSort`. La función
`formatMonthLabels` (en `page.jsx` raíz) renderiza el eje X del gráfico
mensual con nombres en español y año corto en cambios de año.

| Ruta | Qué muestra / permite |
| --- | --- |
| `/facturacion` | Resumen: KPIs (Facturado, Cobrado, Pendiente, Ticket medio), gráfico de barras mensual, desglose de costes y atajos a las sub-páginas. |
| `/facturacion/facturas` | Listado paginado, filtro por estado y búsqueda libre. Drawer con detalle, edición de borrador, acciones (Emitir, Cancelar, Eliminar, Rectificar). |
| `/facturacion/cobros` | Listado de cobros con filtros (método, estado). Drawer para registrar cobro nuevo (selector de facturas pendientes, calcula automáticamente el importe restante). |
| `/facturacion/costes` | Listado con filtros (tipo, categoría, fechas). Drawer de alta/edición con preview de IVA. Borrado inline. |
| `/facturacion/recurrentes` | Listado con activar/pausar. **Banda ámbar prominente** avisando de que las facturas NO se emiten automáticamente. |
| `/facturacion/analitica` | Índice con enlaces a las tres analíticas. |
| `/facturacion/analitica/iva` | Libro IVA + Modelo 303 con KPIs (A pagar / A devolver), tablas por tipo, listado de facturas, botón "Exportar Excel" y aviso de que el resultado es orientativo. |
| `/facturacion/analitica/clientes` | Tabla por cliente: facturado, cobrado, pendiente, costes imputados, margen. |
| `/facturacion/analitica/empleados` | Tabla por empleado: facturado, coste salarial, salario proyectado (solo admin), margen, cancelaciones. |
| `/facturacion/configuracion` | Datos fiscales del emisor, lista editable de tipos de IVA, IVA por defecto, términos de pago, branding, listado de series (solo lectura: el contador no se puede editar). |

Mobile: los drawers usan `top-14 lg:top-0 ... bottom-0` (CLAUDE.md regla 13)
para respetar la barra del menú móvil.

## Migración y backfill

Fichero: `scripts/migrate-billing-rework.js`. Estructura en dos fases:

- **Fase A — `ALTER TYPE` en autocommit**, fuera de transacción global:
  - `enum_invoices_status`: rename `partial` → `partially_paid`, ADD VALUE
    `issued`, `rectified`.
  - `enum_costs_category`: ADD VALUE `opex`.
  - `enum_payments_status`: ADD VALUE `refunded`.
  - Razón: en PostgreSQL anterior a 12, `ADD VALUE` no es transaccional.
- **Fase B — todo en una transacción global**:
  - `ADD COLUMN` para los nuevos campos en `invoices`, `costs`, `clients`,
    `team_members`.
  - `CREATE TABLE` `invoice_series` y `tenant_billing_settings`.
  - Backfills:
    - `costs.incurred_at = (month || '-15')::date` cuando `month` cumple
      `YYYY-MM`. Para filas sin month válido, usa `created_at::date`.
    - `costs`: `tax_base = amount`, `total = amount`, `vat_rate = 0`,
      `tax_amount = 0`, `vat_deductible = false` (conservador, no inventa
      IVA donde no estaba).
    - `costs.amount` y `costs.month`: `DROP NOT NULL` (deprecadas, no
      eliminadas físicamente).
    - `costs.incurred_at`: `SET NOT NULL` después del backfill.
    - `invoices.tax_base = subtotal` cuando `subtotal > 0` y `tax_base = 0`.
    - `invoices.paid_amount = SUM(payments.amount WHERE status='completed')`.
    - `invoices.lines`: enriquece cada línea con `lineBase`/`lineVat`/
      `lineTotal` y `vatRate` por línea (usa `vatRate` global de la factura
      si la línea no lo trae). Solo si la línea aún no tiene esos campos.
  - Asegura serie `F` (default, `nextNumber` calculado desde el `MAX` real
    de facturas existentes) y serie `R`.
  - Asegura una fila en `tenant_billing_settings` con valores por defecto.

La lista de tenants se lee de `master.tenants WHERE status='active'` en
runtime (regla 12 de CLAUDE.md). Es **idempotente**: cada paso comprueba
existencia antes de actuar.

Comandos:

```
npm run db:migrate:billing-rework         # local
npm run db:migrate:billing-rework:prod    # producción
```

En producción la `DATABASE_URL` apunta al hostname interno del Docker; el
script se copia al contenedor con `docker cp` y se ejecuta con `docker exec`
(patrón habitual del repo).

### Sub-migración correctiva: `invoice_series.kind` ENUM (2026-05)

**Bug histórico**: la primera versión de `migrate-billing-rework.js` creaba
la columna `invoice_series.kind` como `VARCHAR(20) NOT NULL DEFAULT 'normal'`,
pero el modelo Sequelize la define como `ENUM('normal', 'rectificative')`.
Cualquier `sync({ alter: true })` posterior falla al intentar convertir el
default `'normal'` (varchar) al ENUM:

> el valor por omisión para la columna «kind» no puede ser convertido
> automáticamente al tipo `enum_invoice_series_kind`

Detectado durante el sprint de QA inicial al ejecutar
`scripts/reset-demo-tenant.js`. La cadena de seeds incluye un
`sync({ alter: true })` indirecto y reventaba.

**Fix permanente** (en `migrate-billing-rework.js`):

- En la fase A (autocommit) se crea el TYPE `enum_invoice_series_kind` si
  no existe, usando el helper `enumTypeExists`.
- En la fase B el `CREATE TABLE invoice_series` declara
  `kind "${schema}"."enum_invoice_series_kind" NOT NULL DEFAULT 'normal'`
  en lugar de `VARCHAR(20)`. Tenants creados a partir de ahora salen ya
  con el tipo correcto.

**Sub-migración correctiva** (`scripts/migrate-billing-fix-kind-enum.js`):

Para tenants donde la migración antigua ya dejó la columna como VARCHAR.
Idempotente, lee slugs desde `master.tenants`. Para cada schema:

1. Salta si la tabla `invoice_series` no existe (módulo billing inactivo).
2. Si el ENUM `enum_invoice_series_kind` no existe, lo crea.
3. Si la columna `kind` ya es `USER-DEFINED` con
   `udt_name=enum_invoice_series_kind`, reporta "already-migrated".
4. Si es `character varying`, ejecuta:
   - `ALTER TABLE … ALTER COLUMN kind DROP DEFAULT`
   - `ALTER TABLE … ALTER COLUMN kind TYPE enum_invoice_series_kind USING kind::enum_invoice_series_kind`
   - `ALTER TABLE … ALTER COLUMN kind SET DEFAULT 'normal'`

Antes de la conversión hace un sanity check (`SELECT DISTINCT kind ...`) y
aborta si encuentra valores no convertibles.

Comandos:

```
npm run db:migrate:billing-fix-kind-enum         # local
npm run db:migrate:billing-fix-kind-enum:prod    # producción
```

**Estado en local (2026-05)**: ejecutada con éxito. 3 tenants migrados
(`crm_aumenta`, `crm_quality_energy`, `crm_spain_enzymes`), 1 ya migrado
(`crm_demo`, alineado previamente por el reset). Re-ejecución idempotente:
4/4 "already-migrated".

**Pendiente en producción**: ejecutar
`npm run db:migrate:billing-fix-kind-enum:prod` la próxima vez que se haga
deploy del módulo billing en el VPS. Mientras tanto el sistema funciona
porque ningún flujo de runtime escribe en `kind` (solo el seed/migración),
pero un `sync({ alter: true })` accidental rompería los tenants no
migrados.

`scripts/reset-demo-tenant.js` mantiene su `alignSchemaQuirks()` como
defensa en profundidad. Tras la migración correctiva debería ser un no-op
en cualquier tenant local.

## Seed

Fichero: `scripts/seed-billing-demo.js`. Comando:
`npm run db:seed:billing-demo`. Solo opera sobre el tenant `demo`.

Idempotente: usa el marcador `[seed-billing-demo]` en `notes`/`description`
para detectar y limpiar la pasada anterior antes de regenerar.

Lo que crea (en este orden):

1. Asegura `TenantBillingSettings` con datos fiscales del emisor demo.
2. Verifica que las series `F` y `R` existen (creadas por la migración).
3. Rellena campos fiscales de hasta 6 clientes existentes (`fiscalName`,
   `taxId`, `fiscalAddress`, `fiscalCity`, `fiscalZip`).
4. Asigna `monthlySalary` a los empleados activos cuyo `displayName` esté
   en la tabla `SALARIES` (Ana García 2400, Carlos López 2700, Laura
   Martínez 2900, Miguel Sánchez 1900).
5. Genera **costes** distribuidos en los 12 meses anteriores: salarios
   mensuales por empleado (vat 0, no deducibles), alquiler, suscripciones
   SaaS, suministros (cada 2 meses), comisiones, material consumible,
   subcontratas eventuales (cada 2 meses), más 2 entradas CAPEX puntuales.
   En total ~110 costes según la cardinalidad real del seed.
6. Genera **11 facturas** (`SCENARIOS`) distribuidas a 0..5 meses atrás, con
   IVA mixto (21 / 10 / 4), una multi-línea, una marcada como `overdue`,
   una pendiente de rectificar.
7. Genera **8 cobros** (`payRatio > 0` en los escenarios sin `rectifyAfter`).
   Una factura queda `overdue` (sin cobros, `dueDate` pasado).
8. Genera **1 factura rectificativa** (serie R) que anula la factura
   marcada como `rectifyAfter`.

Resultado tipo: 11 facturas + 1 rectificativa, 8 cobros, ~110 costes,
salarios proyectados realistas. Distribución diseñada para producir Margen
Bruto 50–70 %, Margen Neto 15–35 % y EBITDA ligeramente superior al Neto
(según los comentarios del propio seed).

## Backlog

Pendiente de sprints futuros, en orden vagamente sugerido:

- **Limpieza de campos legacy en Invoice**: borrado físico de `familyId`,
  `patientId`, `serviceType`, `invoiceType`, `subtotal`, `vatRate` global,
  `discountType`, `discountValue` (todos terapéuticos).
- **Eliminación de `costs.month` y `costs.amount`**: tras confirmar que el
  Libro IVA y los KPIs son correctos durante un ciclo fiscal completo.
- **Limpieza de costes legacy del db-seed antiguo**: hay costes (~38.845 €
  según la nota del prompt original) sin marcador `[seed-billing-demo]` que
  inflan los fijos del demo. Borrarlos al regenerar el seed o filtrarlos.
- **Integración Inventario ↔ Costes**: endpoints + UI sobre
  `Cost.inventoryProductId`. Coincide con el sprint de rework de Inventario.
- **Motor n8n de RecurringInvoice**: cron + webhook + emisión automática
  cuando llegue `nextRunAt`. Hoy todo es manual.
- **Generación de PDF** de la factura (HTML → PDF, con datos fiscales y QR).
- **Integración Verifactu / Facturantia**: rellenar `facturantiaId`,
  `qrUrl`, `verifactuStatus`, `verifactuSentAt` al emitir.
- **Catálogo de productos / servicios** reutilizables.
- **Presupuestos** convertibles a factura.
- **Página detalle de empleado** como ruta propia (`/equipo/[id]`) en lugar
  de drawer.
- **Filtro por estado efectivo** en `GET /api/billing/invoices?status=overdue`
  (hoy filtra por status persistido — ver "Limitaciones conocidas").

## Incoherencias resueltas

Todas las incoherencias identificadas en la documentación inicial se
arreglaron en el sprint inmediatamente posterior. Quedan aquí registradas
solo como historial de decisiones:

1. **`monthsBetween` unificado**. Hoy hay una única implementación, exportada
   desde `lib/billing/billingSummary.js`. El endpoint
   `/api/billing/analytics/employees` la importa, no la duplica.
2. **`/api/billing/recurring*` con guard de admin** y validación de
   `hasModule("billing")` en todos los métodos. GET sigue accesible para
   cualquier autenticado del tenant. La auditoría aplicó el mismo arreglo
   a `/api/billing/rates*`, que también estaba sin guard.
3. **`PeriodPicker` deriva el preset activo del rango actual** (no del query
   param). Cambiar manualmente `from` o `to` resalta automáticamente
   "Personalizado". Llegar por URL compartida con un rango exacto a un
   preset lo resalta automáticamente.
4. **`dueDate` por defecto desde `TenantBillingSettings.defaultPaymentTermsDays`**.
   `POST /invoices` lo aplica si no llega; `POST /invoices/[id]/issue` lo
   completa al emitir si el borrador aún no lo tenía. La UI lo prerellena
   en el formulario de alta.
5. **`overdue` dinámico en lectura**. Helper `lib/billing/invoiceStatus.js`.
   No requiere cron ni migración. El admin sigue pudiendo setearlo
   manualmente vía PATCH (prevalece sobre el cálculo).
6. **Endpoint `POST /invoices/[id]/send`** y botón "Marcar como enviada" en
   el drawer de detalle cuando `status === "issued"`. Acepta `?via=` opcional.

### Limitaciones conocidas (no resueltas en este sprint)

- `GET /api/billing/invoices?status=overdue` filtra por **status persistido**,
  no por `effectiveStatus`. Una factura `issued` con `dueDate` ya pasado
  no aparece en el filtro `?status=overdue`, aunque el GET devuelva
  `status: "overdue"`. Mismo razonamiento para `sortBy=status`. Si en el
  futuro hace falta filtrar por estado efectivo, hay que pasar la lógica
  a SQL (CASE expression sobre `due_date`/`paid_amount`/`total`) o
  post-procesar tras la query.
- El include de `Invoice` en `GET /api/billing/payments` solo trae
  `id`, `number`, `total`, `status`, `clientId`, `issueDate`. No se aplica
  `effectiveStatus` allí porque la página de Cobros no muestra el estado
  de la factura (solo el del cobro). Si más adelante se muestra,
  ampliar el include con `dueDate`, `paidAmount` y mapear con
  `withEffectiveStatus`.
