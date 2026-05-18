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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳
