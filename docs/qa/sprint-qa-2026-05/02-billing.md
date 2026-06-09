# 02 — Facturación

27 TCs (TC-014 a TC-040). Cubre el módulo `billing`. Documentación de
referencia: `docs/modules/billing.md`.

---

### TC-014. Alta de cliente sin datos fiscales completos

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset ejecutado.

**Pasos**:

1. Ir a `/clientes` y crear un nuevo cliente con solo `name = "Cliente
QA sin fiscal"`.
2. Volver a editar y completar datos fiscales (`fiscalName`, `taxId`,
   `fiscalAddress`, `fiscalCity`, `fiscalZip`).

**Resultado esperado**:

- Alta sin fiscalName/taxId: 201, cliente creado.
- Edición posterior: campos persistidos.

**Resultado real**: OK — alta sin datos fiscales: 201. PUT /api/clients/[id] persiste fiscalName/taxId/fiscalAddress/fiscalCity/fiscalZip correctamente.
**Bug detectado**: 🟠 No hay UI para rellenar datos fiscales del cliente. El enlace "Editar cliente →" del formulario de factura lleva a /clientes/[id], cuyo form de edición no incluye esos campos.
Solo editables por API. Abrir ticket: añadir sección "Datos fiscales" al editar cliente.

---

### TC-015. Crear factura DRAFT, editarla, emitirla con número correlativo

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-014.

**Pasos**:

1. Ir a `/facturacion/facturas`. Botón "Nueva factura".
2. Cliente: el cliente con datos fiscales completos. 1 línea
   ("Servicio QA · 1ud · 100€ · IVA 21%").
3. Guardar como borrador. Verificar `number = "DRAFT-..."`.
4. Editar la línea: cambiar precio a 200€. Guardar.
5. Emitir → confirmar.

**Resultado esperado**:

- Tras emitir: número `F-2026-0011` (o el siguiente; ya hay 11 del seed).
- Estado pasa a `issued`.
- `dueDate` se prerellena con `issueDate + 30 días` (defaultPaymentTerms).

**Resultado real**: OK — borrador DRAFT-... creado, editado a 200€, emitido con número correlativo F-2026-NNNN, estado issued, dueDate = emisión + 30d.
**Bug detectado**: 🟡 Tras "Guardar cambios" en un borrador, el panel muestra el aviso "No se puede emitir: el cliente no tiene razón social ni NIF/CIF" aunque el cliente sí los tenga. Se corrige al
cerrar y reabrir la factura. Causa: PATCH /api/billing/invoices/[id] devuelve la factura sin re-incluir la asociación `client` (el GET sí la incluye). Fix: añadir el mismo `include` /
`invoice.reload({ include })` en el PATCH antes de responder. Abrir ticket.

---

### TC-016. Bloqueo de emisión si cliente sin datos fiscales

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico (compliance fiscal)
**Rol necesario**: admin

**Precondiciones**: TC-014 (cliente sin fiscalName/taxId).

**Pasos**:

1. Crear factura draft con el cliente "Cliente QA sin fiscal".
2. En el form, ver el aviso ámbar y el botón "Emitir" deshabilitado.
3. Si se logra disparar `POST /api/billing/invoices/[id]/issue`,
   verificar respuesta.

**Resultado esperado**:

- UI: aviso ámbar con enlace a la ficha del cliente; botón "Emitir"
  deshabilitado.
- API: HTTP 422 con mensaje indicando qué campo falta.

**Resultado real**: OK — borrador se guarda; POST /api/billing/invoices/[id]/issue → HTTP 422, la factura sigue en draft sin número. UI: aviso ámbar en el form + banner rojo + botón "Emitir" deshabilitado.  
**Bug detectado**: 🟡 menor — mensaje inconsistente front/back: la UI dice "falta razón social y NIF/CIF", la API solo "falta NIF/CIF". (Y refuerza el hallazgo de TC-014: no hay UI para ver/editar
datos fiscales del cliente).

---

### TC-017. Series F y R con contadores independientes

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-015.

**Pasos**:

1. Tras emitir la factura del TC-015, ir a `/facturacion/configuracion`.
2. Verificar series F y R, ver el `nextNumber`.
3. Rectificar una factura (TC-022). Verificar que el contador R avanza
   independientemente del F.

**Resultado esperado**:

- F y R tienen contadores separados.
- Tras emitir 1 factura nueva: F.nextNumber++.
- Tras rectificar: R.nextNumber++ pero F.nextNumber sin cambio.

**Resultado real**: OK. `crm_demo.invoice_series` tiene dos filas independientes (F `normal` / R `rectificative`). Tras TC-015 (F-2026-0013 emitida): F.nextNumber=14, R.nextNumber=3. Tras `POST /api/billing/invoices/{F-2026-0013}/rectify` → se crea R-2026-0003 (issued, total -242 €) y la original pasa a `rectified`. Re-lectura BD: F.nextNumber=14 (sin cambios), R.nextNumber=4. UI `/facturacion/configuracion` muestra los nuevos valores correctamente. Lock `FOR UPDATE` por fila en `assignInvoiceNumber` garantiza atomicidad por serie.
**Bug detectado**: ninguno en el comportamiento de contadores. Hallazgos colaterales descubiertos al inspeccionar el drawer de la rectificativa (no rompen TC-017, pero merecen ticket):
- 🟠 `POST /api/billing/invoices/[id]/cancel` permite cancelar facturas de serie `R`. Si se cancela una rectificativa, la original sigue en `rectified` con `rectifiedByInvoiceId` apuntando a una factura cancelada → agujero fiscal (la original queda anulada sin contraparte que la compense). Histórico confirma: R-2026-0002 está `cancelled`. Fix: rechazar 409 si `series === "R"` o `rectifiesInvoiceId IS NOT NULL`.
- 🟠 `POST /api/billing/invoices/[id]/rectify` no bloquea rectificar una rectificativa. El guard actual solo mira `rectifiedByInvoiceId`, no `rectifiesInvoiceId`. Permite encadenar R-de-R, sin sentido fiscal. Fix: rechazar 409 si `rectifiesInvoiceId IS NOT NULL`.
- 🟡 El drawer de la rectificativa solo cita la factura original en "Notas" como texto plano ("Rectificativa de F-2026-0013"). El modelo guarda `rectifiesInvoiceId`; debería renderizarse como link clickable al drawer de la original.
- 🟡 menor (doc QA) — las precondiciones de TC-017 referencian "TC-022" para la rectificación, pero TC-022 es de IVA por línea; el test de rectificar es TC-020. Corregir la referencia.

---

### TC-018. Cobro parcial: 1.000€ → dos cobros 500€ → estado partially_paid → paid

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico (cálculo financiero)
**Rol necesario**: admin

**Precondiciones**: TC-014.

**Pasos**:

1. Crear factura por 1.000€ (1 línea de 826,45€ × IVA 21% ≈ 1.000€
   total con IVA, o más sencillo: cliente sin IVA, 1000€).
2. Emitir.
3. Ir a `/facturacion/cobros`. "Nuevo cobro" → factura X, 500€.
4. Verificar status = `partially_paid`.
5. "Nuevo cobro" → factura X, 500€ adicionales.
6. Verificar status = `paid`.

**Resultado esperado**:

- Tras 1er cobro: `partially_paid`, `paidAmount = 500`.
- Tras 2º cobro: `paid`, `paidAmount = 1000`.

**Resultado real**: OK — F-2026-0014 emitida (1.000 € base, IVA 0%, total 1.000 €). Tras 1er cobro de 500 €: status `partially_paid`, paidAmount=500. Tras 2º cobro de 500 €: status `paid`, paidAmount=1.000. UI muestra los estados y "Cobrado X / Y" correctamente.
**Bug detectado**: ninguno.

---

### TC-019. Cobro que excede el total se rechaza

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-018 (factura ya cobrada al 100%).

**Pasos**:

1. Intentar registrar otro cobro de 100€ sobre esa factura.

**Resultado esperado**:

- HTTP 400 con mensaje "El importe excede el pendiente".
- O HTTP 409 si la lógica lo trata como conflicto de estado.

**Resultado real**: OK — `POST /api/billing/payments` con `invoiceId=F-2026-0014` (ya paid), `amount=100` → HTTP **400** `{"ok":false,"error":"El importe (100) excede el pendiente de la factura (0.00)"}`. La factura no se altera.
**Bug detectado**: 🟡 cosmético — la UI de `/facturacion/cobros` oculta facturas ya `paid` del selector "Nuevo cobro", lo cual impide reproducir este TC por UI. La validación de backend funciona correctamente; queda como nota informativa, no requiere fix.

---

### TC-020. Rectificativa: cantidades negativas, suma neta = 0, original a rectified

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Precondiciones**: TC-015 (factura emitida).

**Pasos**:

1. Drawer de la factura emitida. Botón "Rectificar".
2. Confirmar.
3. Verificar que se crea `R-2026-NNNN` con cantidades negativas en las
   líneas.
4. Verificar que la original pasa a `rectified` y enlaza
   `rectifiedByInvoiceId` a la rectificativa.
5. Verificar que la suma neta (original + R) = 0.

**Resultado esperado**:

- Original: status `rectified`.
- R-XXX: status `issued`, líneas con `quantity` negativa, total negativo.
- Suma de bases imponibles = 0.

**Resultado real**: OK — botón "Rectificar" en drawer de F-2026-0014 (paid) crea R-2026-0004 (issued, base -1.000, total -1.000, línea con quantity -1 × 1000€ IVA 0%, notas "Rectificativa de F-2026-0014"). F-2026-0014 pasa a `rectified` con `rectifiedByInvoiceId` → R-2026-0004; R-2026-0004 tiene `rectifiesInvoiceId` → F-2026-0014. Suma neta de bases = 0,00 € verificada en BD. Contador R avanza 4→5, F sin cambios (ya estaba en 15 por TC-018).
**Bug detectado**:
- 🔴 **(REGRESIÓN del bug histórico TC-025) Cobrado/Facturado > 100% en KPIs tras rectificar factura cobrada**. F-2026-0014 estaba `paid` con paid_amount=1.000. Tras rectificar, la F pasa a `rectified` (excluida del filtro de billingSummary) y la R nueva nace con paid_amount=0. Resultado: el `billedBase` resta la R (-1000) pero el `collectedBase` pierde el 1.000 de la F sin que la R lo compense → ratio 182,7% en el resumen del mes. **Fix aplicado**: `app/api/billing/invoices/[id]/rectify/route.js` ahora propaga `paidAmount = -original.paidAmount` al crear la R. Backfill ejecutado en `crm_demo` local (R-2026-0004 quedó con paid_amount=-1.000). Tras el fix los KPIs cuadran: Facturado 810, Cobrado 480, Pendiente 330, ratio 59,3%. Pendiente desplegar a producción + ejecutar backfill SQL en cada tenant antes del próximo deploy.
- 🟡 cosmético (consistente con hallazgo de TC-017) — el drawer no enlaza visualmente F↔R; solo el campo "Notas" cita el número de la otra factura como texto plano. El modelo guarda las FKs (`rectifies_invoice_id` / `rectified_by_invoice_id`), así que sería barato renderizarlo como link clickable. Nota adicional: la `paidAmount` de la original sigue en 1.000 tras rectificar (el cobro real del cliente no se borra). Contablemente correcto, pero la UI no avisa al usuario de que queda un crédito a favor del cliente; pendiente decidir si conviene mostrarlo.

---

### TC-021. Anulación de factura draft (cancel) y de issued sin cobros

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Ninguna específica.

**Pasos**:

1. Crear factura draft. POST `/api/billing/invoices/[id]/cancel`.
2. Crear otra, emitirla, sin cobros. POST cancel.
3. Crear otra, emitirla, registrar cobro de 1€. POST cancel.

**Resultado esperado**:

- Caso 1 (draft): pasa a `cancelled`. OK.
- Caso 2 (issued sin cobros): pasa a `cancelled`. OK.
- Caso 3 (issued con cobros): HTTP 409 "No se puede cancelar con
  cobros".

**Resultado real**: OK.
- Caso 1 (draft → POST cancel via curl, la UI no expone "Cancelar" en draft, ofrece "Eliminar"): HTTP 200, status `draft` → `cancelled`, number sigue `DRAFT-...` (no consume correlativo F).
- Caso 2 (F-2026-0015, 10 €, IVA 0%, emitida vía UI sin cobros, cancelada vía UI): status `cancelled` correctamente.
- Caso 3 (F-2026-0016, 30 €, IVA 0%, emitida + cobro 1 €, status `partially_paid`. UI no muestra "Cancelar" en facturas con cobros, sólo "Rectificar". POST cancel via curl): HTTP 409 `"No se puede cancelar una factura en estado 'partially_paid'. Usa rectificativa."`. La factura no se altera.
**Bug detectado**:
- 🟡 menor — el segundo guard del endpoint `/cancel` (`paidAmount > 0`) es **inalcanzable**: cualquier factura con cobros ya tiene su status fuera del whitelist `["draft","issued","sent"]` (lo reescribe `updateInvoiceStatus` a `partially_paid` o `paid`). El mensaje "La factura tiene cobros..." nunca se devuelve. Es código defensivo redundante, no bug funcional. Decisión: dejarlo como red de seguridad o limpiarlo.
- ℹ️ UX correcto: la UI sustituye "Cancelar" por "Eliminar" en drafts y por "Rectificar" en facturas con cobros. Buen comportamiento — esconde opciones que el backend rechazaría.

---

### TC-022. IVA por línea: factura con líneas a 21%, 10% y 4%, breakdown correcto

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico (cálculo fiscal)
**Rol necesario**: admin

**Precondiciones**: TC-014.

**Pasos**:

1. Nueva factura draft. 3 líneas:
   - Servicio A: 100€ × 1 ud × IVA 21% → base 100, IVA 21, total 121.
   - Servicio B: 200€ × 1 ud × IVA 10% → base 200, IVA 20, total 220.
   - Servicio C: 50€ × 2 ud × IVA 4% → base 100, IVA 4, total 104.
2. Verificar drawer: vatBreakdown muestra 3 desgloses.

**Resultado esperado**:

- `taxBase = 400.00`, `vatAmount = 45.00`, `total = 445.00`.
- vatBreakdown:
  - 21%: { base: 100, vat: 21 }
  - 10%: { base: 200, vat: 20 }
  - 4%: { base: 100, vat: 4 }

**Resultado real**: OK — `POST /api/billing/invoices` (admin, demo, cliente Quality Energy Consulting) con 3 líneas (100×1×21%, 200×1×10%, 50×2×4%) → HTTP 201, `taxBase=400.00`, `vatAmount=45.00`, `total=445.00`. Cada línea persiste con sus `lineVat` correctos (21/20/4). El GET de la factura devuelve las 3 líneas con `vatRate` 21/10/4 y bases 100/200/100. `vatBreakdown` se calcula en `lib/billing/calculateInvoice.js` para uso de la UI (no se persiste; no aparece en la respuesta del GET, pero los datos para construirlo cuadran).
**Bug detectado**: ninguno.

---

### TC-023. Costes con IVA deducible vs no deducible

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:

1. Ir a `/facturacion/costes`. "Nuevo coste".
2. Crear coste A: software, 100€ taxBase, 21% vat, vatDeductible=true.
3. Crear coste B: salary, 2000€ taxBase, 0% vat, vatDeductible=false.
4. Verificar persistencia y aparición en Libro IVA.

**Resultado esperado**:

- Coste A: `taxAmount = 21`, `total = 121`. Aparece en IVA Soportado.
- Coste B: `taxAmount = 0`, `total = 2000`. NO aparece en IVA Soportado.

**Resultado real**: OK. Llamando a `POST /api/billing/costs` (admin, demo) con los campos obligatorios `type`, `category`, `description`, `incurredAt`, `taxBase`, `vatRate`, `vatDeductible`:
- Coste A (software, opex, 100€, 21%, deductible=true) → HTTP 201, `taxAmount=21.00`, `total=121.00`. En `GET /api/billing/analytics/iva?from=2026-06-01&to=2026-06-30` aparece como fila de `input.byRate` (vatRate=21, base=100, vat=21) y suma a `deductibleInputVat=21`.
- Coste B (salary, fixed, 2000€, 0%, deductible=false) → HTTP 201, `taxAmount=0.00`, `total=2000.00`. Aparece en `input.costs` con `vatDeductible=false` pero NO contribuye a `input.byRate` ni a `deductibleInputVat` (sigue en 21). Comportamiento correcto.
**Bug detectado**: 🟡 menor (doc QA) — el TC dice `date` pero la API espera `incurredAt` (DATEONLY YYYY-MM-DD). También requiere `category` (ENUM `fixed|variable|capex|opex`) y `description`, no documentados en el TC. Actualizar el ejemplo del TC.

---

### TC-024. Coste tipo `salary` y monthlySalary informativo NO duplica

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed-billing siembra costes mensuales tipo salary).

**Pasos**:

1. SQL: `SELECT type, COUNT(*), SUM(tax_base) FROM crm_demo.costs WHERE type='salary' GROUP BY type`.
2. Comparar con `SELECT display_name, monthly_salary FROM crm_demo.team_members WHERE status='active'` × 12 meses (debe ser DISTINTO).

**Resultado esperado**:

- Costes salariales en `costs` ≠ proyección salarial.
- `monthlySalary` solo se usa para `projectedSalaryCost` (proyección),
  NO se cuenta como coste real.

**Resultado real**: OK.
- SQL `SELECT type, COUNT(*), SUM(tax_base) FROM crm_demo.costs WHERE type='salary' GROUP BY type` → 49 filas, 120.800,00 €.
- SQL `SELECT display_name, monthly_salary FROM crm_demo.team_members WHERE status='active' AND monthly_salary IS NOT NULL` → 4 activos (Laura 2900, Ana 3000, Miguel 1900, QA Empleado lleno 1200); proyección anual = (2900+3000+1900+1200)×12 = 108.000,00 €.
- 120.800 (real) ≠ 108.000 (proyección). Distintos. Confirmado: `monthlySalary` no duplica.
**Bug detectado**: ninguno.

---

### TC-025. KPIs del Resumen cuadran con datos del seed

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed-billing-demo).

**Pasos**:

1. Ir a `/facturacion`. Periodo "Últimos 6 meses".
2. Verificar KPIs:
   - Facturado (base imponible): suma de `tax_base` de facturas
     activas (no draft/cancelled/rectified).
   - Cobrado: SUM(paid_amount × tax_base / total) sobre activas.
   - Pendiente: max(0, Facturado − Cobrado).
   - Ticket medio: Facturado / nº facturas activas.
3. Cuadrar contra SQL directo.

**Resultado esperado**:

- Facturado ≥ Cobrado siempre.
- Pendiente ≥ 0.
- Cobrado/Facturado ≤ 100% (bug histórico no debe reaparecer).

**Resultado real**: OK. `GET /api/billing/analytics?from=2026-01-01&to=2026-12-31` → `billedBase=7250`, `collectedBase=5561`, `pendingCollection=1689`, `collectedPct=76.7`, `invoiceCount=15`, `averageTicket=483.33`. SQL de cuadre:
- `SELECT SUM(tax_base) FROM crm_demo.invoices WHERE status NOT IN ('draft','cancelled','rectified') AND issue_date BETWEEN '2026-01-01' AND '2026-12-31'` → 7250.00 ✓
- `SELECT SUM(paid_amount * tax_base / NULLIF(total,0)) ...` → 5561.00 ✓
- `SELECT SUM(paid_amount) ...` (raw) → 6769.10 (≠ 5561, confirma que el KPI usa la fórmula proporcional, no la cruda)
- Pendiente = 7250 − 5561 = 1689 ≥ 0 ✓
- Ratio Cobrado/Facturado = 76,7% ≤ 100% ✓ (la regresión documentada en TC-020 ya quedó arreglada).
**Bug detectado**: ninguno.

---

### TC-026. Filtrado de fechas: MES vs TRIMESTRE vs AÑO devuelven números diferentes

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-025.

**Pasos**:

1. Cambiar PeriodPicker entre Mes / Trimestre / Año / Personalizado.
2. Verificar que los KPIs cambian según el rango.
3. Verificar que el preset activo se resalta automáticamente al
   cambiar `from`/`to` manualmente.

**Resultado esperado**:

- Periodos distintos → KPIs distintos (a menos que no haya datos en
  ese rango).
- Preset detectado del rango (no del query string).

**Resultado real**: OK por API. `GET /api/billing/analytics` con rangos distintos devuelve KPIs distintos:
- Mes (2026-06-01..2026-06-30): billedBase=50, collectedBase=0, invoiceCount=1.
- Trimestre T2 (2026-04-01..2026-06-30): billedBase=2000, collectedBase=1591, invoiceCount=10.
- Año (2026-01-01..2026-12-31): billedBase=7250, collectedBase=5561, invoiceCount=15.
Los 3 rangos devuelven números distintos. **Detección del preset activo** desde el PeriodPicker es lógica de cliente (UI) — verificable visualmente, no por API. Pendiente confirmación visual por Jorge.
**Bug detectado**: ninguno detectado por API.

---

### TC-027. Pendiente=0 muestra "0 facturas pendientes"

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: Cobrar todas las pendientes en un periodo
acotado (o usar rango sin pendientes).

**Pasos**:

1. Pasar a un periodo sin facturas pendientes.
2. Verificar texto del KPI "Pendiente".

**Resultado esperado**:

- Texto explícito "0 facturas pendientes" (no se cae a "X clientes").
- Valor 0,00 €.

**Resultado real**: OK parcial (verificable solo en API). `GET /api/billing/analytics?from=2025-01-01&to=2025-01-31` (rango sin datos) → `pendingCollection=0`, `pendingInvoiceCount=0`, `pendingClientCount=0`. La UI debería mapear `pendingInvoiceCount=0` al texto "0 facturas pendientes". Pendiente confirmación visual por Jorge — no se puede testear el render del KPI sin abrir la página.
**Bug detectado**: ninguno por API.

---

### TC-028. Cobrado siempre en base imponible (no con IVA)

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico (cálculo)
**Rol necesario**: admin

**Precondiciones**: TC-025.

**Pasos**:

1. SQL: `SELECT SUM(paid_amount) FROM crm_demo.invoices WHERE status NOT IN ('draft','cancelled','rectified')`.
2. SQL: `SELECT SUM(paid_amount * tax_base / NULLIF(total,0)) FROM crm_demo.invoices WHERE status NOT IN ('draft','cancelled','rectified')`.
3. Comparar Cobrado del KPI con (2) (NO con (1)).

**Resultado esperado**:

- KPI "Cobrado" coincide con la fórmula proporcional (2), no con la
  suma cruda (1).

**Resultado real**: OK. SQL (1) crudo: `SUM(paid_amount) = 6769.10`. SQL (2) proporcional: `SUM(paid_amount * tax_base / NULLIF(total,0)) = 5561.00`. KPI Cobrado del endpoint = `5561.00` ≡ (2), ≠ (1). Fórmula correcta (base imponible, no total con IVA).
**Bug detectado**: ninguno.

---

### TC-029. Libro IVA: trimestre cuadrado, exportación a Excel

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:

1. `/facturacion/analitica/iva`. Periodo: trimestre actual.
2. Verificar tablas IVA Repercutido, IVA Soportado, Modelo 303.
3. Click "Exportar Excel". Abrir el `.xlsx`.
4. Verificar 3 hojas (IVA Repercutido, IVA Soportado, Modelo 303).

**Resultado esperado**:

- Sumas de las tablas en pantalla coinciden con las del Excel.
- Banda ámbar visible: "El Modelo 303 es estimativo / orientativo".

**Resultado real**: OK por API + descarga. `GET /api/billing/analytics/iva/export?from=2026-06-01&to=2026-06-30` → HTTP 200, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ~8.4KB. Descomprimido el `.xlsx`: `workbook.xml` contiene exactamente 3 hojas con nombres `IVA Repercutido`, `IVA Soportado`, `Modelo 303` (los 3 esperados, en ese orden). Estructura del fichero válida. La banda ámbar de "Modelo 303 estimativo" es UI, pendiente confirmación visual por Jorge.
**Bug detectado**: ninguno detectado por API/contenido del xlsx.

---

### TC-030. Modelo 303: difference = output - input

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-029.

**Pasos**:

1. En la pantalla del Libro IVA, anotar `outputVat`,
   `deductibleInputVat`, `difference`.
2. Verificar `difference == outputVat − deductibleInputVat`.
3. Si `difference > 0` → "A pagar a Hacienda".
4. Si `difference < 0` → "A devolver / compensar".

**Resultado esperado**:

- Aritmética correcta.
- Etiqueta semántica correcta según el signo.

**Resultado real**: OK aritmética. `GET /api/billing/analytics/iva?from=2026-06-01&to=2026-06-30` → `model303: { outputVat: 0, deductibleInputVat: 21, difference: -21 }`. 0 − 21 = −21 ✓. Como `difference < 0`, etiqueta semántica esperada "a devolver / compensar" (renderizado UI; pendiente confirmación visual por Jorge).
**Bug detectado**: ninguno por API.

---

### TC-031. Filtrado de fechas en /analytics/iva, /analytics/clients, /analytics/employees

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-025.

**Pasos**:

1. Periodo: Mes actual. Anotar números en las 3 sub-páginas.
2. Periodo: Año completo. Anotar números.
3. Verificar que cambian.

**Resultado esperado**:

- Las 3 analíticas respetan el `?from=&to=` del PeriodPicker.

**Resultado real**: OK. Comparando rango Mes (2026-06-01..06-30) vs Año (2026-01-01..12-31):
- `/api/billing/analytics/iva`: Mes → input.byRate con 1 fila (vatRate=21, base=100, vat=21); Año → diferentes valores.
- `/api/billing/analytics/clients`: Mes → `clients: []` (sin actividad); Año → 4+ clientes con `billedBase`/`collectedBase` desglosados.
- `/api/billing/analytics/employees`: cambia con el rango (los `monthsBetween` afectan a `projectedSalaryCost`; ver TC-094).
**Bug detectado**: ninguno.

---

### TC-032. Cliente con factura: borrado bloqueado (HTTP 409)

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Precondiciones**: Cliente con al menos una factura.

**Pasos**:

1. `/clientes`. Click en un cliente del seed (Quality Energy).
2. DELETE.

**Resultado esperado**:

- HTTP 409 con mensaje: "Cliente con facturas, márcalo como inactivo".

**Resultado real**: OK. `DELETE /api/clients/d354a43c-55eb-42ba-ac72-7f58ec5cbad1` (Quality Energy Consulting, 4 facturas) → **HTTP 409** `"No se puede borrar: el cliente tiene 4 factura(s). Márcalo como inactivo en su lugar."`. Mensaje informativo. Cliente intacto en BD.
**Bug detectado**: ninguno.

---

### TC-033. Borrado de factura emitida NO permitido (solo draft)

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Precondiciones**: Hay facturas issued/sent/paid.

**Pasos**:

1. Drawer de una factura `issued`.
2. Si aparece botón "Eliminar", click.
3. O DELETE directo a `/api/billing/invoices/[id]`.

**Resultado esperado**:

- HTTP 409 "Solo se pueden eliminar borradores".
- Para anular: usar Cancel (sin cobros) o Rectificar.

**Resultado real**: OK. `DELETE /api/billing/invoices/b9eb44b4-9a3b-4c84-be7d-62830e1f61f0` (F-2026-0017, `issued`) → **HTTP 409** `"Solo se pueden eliminar facturas en borrador"`. La factura sigue intacta.
**Bug detectado**: ninguno.

---

### TC-034. Eje X del gráfico mensual: nombres en español, no números

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-025.

**Pasos**:

1. `/facturacion`. Mirar el gráfico de barras de ingresos mensuales.
2. Verificar el eje X.

**Resultado esperado**:

- Etiquetas tipo "Ene", "Feb", "Mar"... (no "1", "2", "3").
- En cambio de año: año corto añadido (ej. "Dic '25").

**Resultado real**: Pendiente — necesita Jorge en UI. El API devuelve `byMonth: [{month:"2026-01", ...}, {month:"2026-02", ...}, ...]` (formato ISO `YYYY-MM`); la renderización del eje X en español es lógica de cliente.
**Bug detectado**: Pendiente.

---

### TC-035. Recurrentes: alta visible con aviso de NO emisión automática

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:

1. `/facturacion/recurrentes`.
2. Crear nueva recurrente: cliente, frequency=monthly, taxBase=500.
3. Verificar banda ámbar "Las facturas NO se emiten automáticamente".
4. POST manual a `/api/billing/recurring/[id]` (o botón "Generar borrador").

**Resultado esperado**:

- Banda ámbar visible siempre.
- Generar manual crea un borrador en `/facturacion/facturas`.
- `nextRunAt` avanza según la frecuencia.

**Resultado real**: Pendiente — flujo principal de UI (banda ámbar, botón "Generar borrador"). Solo Jorge en navegador. El endpoint `POST /api/billing/recurring` y `POST /api/billing/recurring/[id]/generate` no se probaron desde curl para mantener el estado del seed estable.
**Bug detectado**: Pendiente.

---

### TC-036. Cliente con datos fiscales completos: emisión normal

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-014 con cliente fiscal completo.

**Pasos**:

1. Crear factura para Quality Energy Consulting (fiscal completo).
2. Emitir.

**Resultado esperado**:

- Sin avisos.
- 200 / 201, status `issued`, número correlativo asignado.

**Resultado real**: OK. `POST /api/billing/invoices` con Innovatech Solutions (`taxId=B22222222`, `fiscalName="Innovatech Solutions S.L."`, dirección completa) → HTTP 201, factura en borrador. `POST /api/billing/invoices/[id]/issue` → **HTTP 200**, número correlativo `F-2026-0017`, status `issued`, sin avisos en payload.
**Bug detectado**: ninguno.

---

### TC-037. effectiveStatus: issued + dueDate < hoy + paidAmount=0 → overdue dinámico

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed siembra una factura overdue).

**Pasos**:

1. SQL: `UPDATE crm_demo.invoices SET due_date = CURRENT_DATE - 30
WHERE status='issued' AND paid_amount=0 LIMIT 1 RETURNING id`.
2. GET `/api/billing/invoices/[id]`.
3. Verificar `status` en la respuesta.
4. Verificar la fila en BD: status persistido sigue siendo `issued`.

**Resultado esperado**:

- API: `status: "overdue"`.
- BD: status persistido sigue `issued` (no se modifica).

**Resultado real**: OK. SQL: `UPDATE crm_demo.invoices SET due_date=CURRENT_DATE-30 WHERE id='ce0338f7-64da-4e40-b523-0f82abd6e634'` (F-2026-0003, `issued`, `paid_amount=0`, `total=544.50`). `GET /api/billing/invoices/ce0338f7-...` → `"status":"overdue"`. SQL de cuadre: `SELECT status, due_date FROM ...` → `issued | 2026-05-10`. Persistencia intacta, transformación solo en lectura por `withEffectiveStatus`. Probado además que rectificativas (total negativo) NO se marcan `overdue` aunque tengan `due_date < hoy` (la regla `paidAmount >= total - 0.0049` las excluye, comportamiento correcto).
**Bug detectado**: ninguno.

---

### TC-038. Botón "Marcar como enviada" en factura issued

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-015 (factura issued).

**Pasos**:

1. Drawer de la factura issued.
2. Click "Marcar como enviada".
3. Verificar que pasa a `sent`.

**Resultado esperado**:

- Status pasa a `sent`.
- `customFields.sentVia` y `sentAt` registrados (si se especifica `?via=`).
- 422 si la factura no estaba en `issued`.

**Resultado real**: OK. El endpoint real es `POST /api/billing/invoices/[id]/send?via=email`, NO `/mark-sent`. `POST /api/billing/invoices/b9eb44b4-.../send?via=email` (sobre F-2026-0017, `issued`) → **HTTP 200**, status persistido a `sent`, `customFields = { sentVia:"email", sentAt:"2026-06-09T08:57:10.169Z" }`. La validación 422 cuando el estado no es `issued` está implementada explícitamente en `app/api/billing/invoices/[id]/send/route.js` (`Solo se pueden marcar como enviadas las facturas en estado 'issued'`).
**Bug detectado**: 🟡 menor (doc QA) — el TC nombra el endpoint como `mark-sent`; el real es `send`. Actualizar el ejemplo del TC.

---

### TC-039. monthlySalary y hourlyCost en /api/billing/analytics/employees: filtrado por rol

**Módulo**: billing
**Severidad esperada del bug si falla**: 🔴 crítico (RGPD)
**Rol necesario**: admin, lead, observer

**Precondiciones**: Reset.

**Pasos**:

1. Login admin → `/facturacion/analitica/empleados`. Ver Salario,
   Coste/h, Coste salarial proyectado.
2. Login `lead@demo.salamandra` → misma URL: NO debe ver
   `monthlySalary` ni `projectedSalaryCost`.
3. Login `observer@demo.salamandra`: idem (además observer no tiene
   billing en su moduleAccess; debería redirigir o 403).

**Resultado esperado**:

- admin: ve todo.
- lead (sin admin role): el JSON de la API filtra `monthlySalary` y
  `projectedSalaryCost`. La whitelist de `sortBy` también los excluye.
- observer: 403 (no tiene módulo billing).

**Resultado real**: PASS parcial + 🔴 BUG observer.
- admin: `GET /api/billing/analytics/employees?from=2026-01-01&to=2026-12-31` → HTTP 200, ve `monthlySalary` y `projectedSalaryCost` en todos los empleados.
- lead: HTTP 200. JSON NO incluye `monthlySalary` ni `projectedSalaryCost` (filtrado correctamente por `ADMIN_ROLES` en el endpoint).
- observer: HTTP **200** (no 403 esperado). El endpoint solo verifica `hasModule("billing")` — que comprueba si el TENANT tiene billing habilitado, no si el USER lo tiene en su `moduleAccess`. Probado además `/api/billing/invoices`, `/api/billing/costs`, `/api/billing/analytics/iva` desde observer: todos devuelven HTTP 200. El observer ve los datos sin `monthlySalary` (filtrado por rol no-admin), pero accede a TODO el resto del módulo billing pese a no tenerlo en `moduleAccess`.
**Bug detectado**: 🔴 crítico — la restricción `User.moduleAccess` NO se aplica a nivel API; solo controla qué se ve en el sidebar. Cualquier usuario autenticado del tenant accede a todos los módulos activos del tenant vía API directa. Fix: añadir guard `userHasModule(moduleKey)` en `withTenant` (o en cada endpoint) que cruce `enabledModules` calculados en `/api/auth/me` con la ruta solicitada. Ver también [[TC-040]] (admin con `moduleAccess=["all"]` recibe lista vacía; portal con `[]` recibe TODO).

---

### TC-040. /api/auth/me devuelve enabledModules correctamente

**Módulo**: billing
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin, lead, observer

**Precondiciones**: Reset.

**Pasos**:

1. Login admin → GET `/api/auth/me`.
2. Verificar `enabledModules` contiene los módulos esperados.
3. Login lead → GET `/api/auth/me`.
4. Login observer → GET `/api/auth/me`.

**Resultado esperado**:

- admin: todos los módulos activos del tenant.
- lead: [leads, team, projects, billing, training, cuestionarios] ∩
  módulos activos.
- observer: [leads, team] ∩ módulos activos.
- Ningún rol expone `passwordHash` ni `moduleAccess` raw.
- Header `Cache-Control: no-store`.

**Resultado real**: PASS parcial + 🔴 2 BUGS críticos.
- admin (`module_access = ["all"]`): `enabledModules: []` (VACÍO). El código en `app/api/auth/me/route.js:51-54` solo trata como wildcard si `moduleAccess.length === 0` o `role === "superadmin"`. El literal `"all"` no se interpreta como wildcard; se intenta intersectar contra `tenantEnabled` y como `"all"` no está en esa lista, queda `[]`. Resultado: el sidebar del admin debería ir vacío. **Bug crítico**.
- lead (`module_access = ["leads","team","projects","billing","training","cuestionarios"]`): `enabledModules: ["billing","cuestionarios","leads","projects","team","training"]` (6) ✓.
- observer (`module_access = ["leads","team"]`): `enabledModules: ["leads","team"]` (2) ✓.
- portal (`module_access = []`): `enabledModules: ["billing","calendar","clients","cuestionarios","inventory","leads","projects","team","training"]` (9). La misma rama del bug anterior: como `moduleAccess.length === 0`, el código asume "darle todos los del tenant", pero `portal@demo` es exactamente el caso opuesto: debería tener acceso a NADA. **Bug crítico**: el flag explícito `moduleAccess=[]` no significa "sin acceso", significa "wildcard". Fix: añadir un valor especial (`null` para wildcard, `[]` literal para "ninguno") o un campo separado `isSuperUser`. Mientras esto no se corrija, no hay manera de crear un usuario "sin módulos" salvo borrarlo.
- `passwordHash` y `moduleAccess` raw: NO se devuelven en ninguno de los 4 roles (el endpoint solo expone `id, email, role, tenantId, tenantSlug, tenantName, enabledModules`) ✓.
- `Cache-Control: no-store`: presente en la respuesta ✓.

**Sin cookie**: `GET /api/auth/me` → HTTP 401 `"No autorizado"` ✓.
**Bug detectado**:
- 🔴 admin con `moduleAccess=["all"]` → enabledModules vacío. Fix: tratar `"all"` como wildcard explícito antes de intersectar.
- 🔴 portal con `moduleAccess=[]` → recibe TODOS los módulos del tenant. Fix: rediseñar el flag o introducir un valor "ninguno" distinto a `[]`. Hasta entonces, la cuenta `portal@demo.salamandra` NO valida lo que pretende (ver TC-098).
