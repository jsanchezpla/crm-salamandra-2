# 06 — Cross-module

10 TCs (TC-086 a TC-095). Cubre integraciones entre módulos.

---

### TC-086. Cliente borrado en /clientes con/sin facturas

**Módulo**: cross-module (clients × billing)
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:
1. Crear cliente nuevo SIN facturas. DELETE → debe borrar.
2. Cliente con factura del seed (Quality Energy Consulting). DELETE.

**Resultado esperado**:
- Sin facturas: 204.
- Con facturas: 409 "Cliente con facturas".

**Resultado real**: OK.
- Sin facturas: creé `QA TC-086 sin facturas` con POST y luego `DELETE /api/clients/<id>` → **HTTP 204**.
- Con facturas: `DELETE /api/clients/d354a43c-...` (Quality Energy Consulting, 4 facturas) → **HTTP 409** `"No se puede borrar: el cliente tiene 4 factura(s). Márcalo como inactivo en su lugar."`.
**Bug detectado**: ninguno.

---

### TC-087. Sección Facturación en /clientes/[id] cuadra con datos reales

**Módulo**: cross-module (clients × billing)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed-billing siembra facturas para
clientes existentes).

**Pasos**:
1. `/clientes/<id_con_facturas>`.
2. Ver sección "Facturación" embebida (`ClientBillingSection`).
3. Comparar KPIs (Facturado, Cobrado, Pendiente, Margen) con SQL
   directo agrupando por `client_id`.

**Resultado esperado**:
- Datos cuadran.
- Si el módulo billing no está activo → sección oculta silenciosamente
  (403 → no renderiza).

**Resultado real**: Pendiente UI — sección embebida `ClientBillingSection`. La API `GET /api/clients/<id>/billing-summary` está implementada (verificada en TC-091: devuelve `billedBase, billedTotal, collectedBase, pendingCollection, invoiceCount, imputedCosts, margin, marginPct, invoices[]`). Si el módulo billing no está activo, el endpoint debería responder 403 y la sección no debería renderizar. Render visual y comportamiento del fallback en `/clientes/[id]` quedan para Jorge.
**Bug detectado**: Pendiente.

---

### TC-088. Empleado dado de baja: comportamiento con sus tareas/proyectos

**Módulo**: cross-module (team × projects)
**Severidad esperada del bug si falla**: 🟡 cosmético (a documentar)
**Rol necesario**: admin

**Pasos**:
1. DELETE soft de un empleado que es lead/member de algún proyecto
   (ej. Carlos López → lead de PRY-2026-0002).
2. Verificar:
   - ProjectMember sigue existiendo.
   - El proyecto sigue mostrando al empleado.
   - Listado del proyecto muestra el badge "inactivo" o filtra.

**Resultado esperado**:
- Documentar comportamiento real (la docs no especifica una regla).
- Esperado mínimo: el ProjectMember NO se borra automáticamente.

**Resultado real**: OK — comportamiento documentado. Probado sobre Carlos López (`team_members.id=2b2d6d57-...`, lead de PRY-2026-0002 y member de PRY-2026-0001):
- `DELETE /api/team/<carlos_id>` → **HTTP 204** (soft delete, status pasa a `inactive`).
- SQL: `SELECT COUNT(*) FROM crm_demo.project_members WHERE team_member_id=<carlos_id>` → **2** (NO se borran).
- El proyecto sigue mostrando a Carlos como lead/member. Restauré con PATCH `{"status":"active"}` para no dejar el seed roto.
**Bug detectado**: ninguno. Decisión a documentar en `docs/modules/team.md`: el soft delete de TeamMember NO propaga; los ProjectMember persisten; la UI debe pintar badge "inactivo" en miembros con `team_member.status='inactive'`.

---

### TC-089. Empleado en drawer /equipo: sección Facturación cuadra

**Módulo**: cross-module (team × billing)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-014.

**Pasos**:
1. Drawer de Ana García en `/equipo`.
2. Sección Facturación: cambiar a trimestre actual.
3. SQL: `SELECT SUM(tax_base) FROM crm_demo.invoices WHERE employee_id=(SELECT id FROM crm_demo.team_members WHERE display_name='Ana García')` para validar.

**Resultado esperado**:
- Datos cuadran con SQL.
- `monthlySalary` y `projectedSalaryCost` solo visibles para admin.

**Resultado real**: Pendiente UI — sección embebida del drawer en `/equipo`. La fuente subyacente (`/api/billing/analytics/employees`) ya está cubierta por TC-039 (filtrado por rol correctamente) y TC-094 (recálculo de `projectedSalaryCost`). El render dentro del drawer queda para Jorge.
**Bug detectado**: Pendiente.

---

### TC-090. Empleado en drawer /equipo: sección Proyectos cuadra con ProjectMember

**Módulo**: cross-module (team × projects)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:
1. Drawer de Ana García en `/equipo`.
2. Sección Proyectos: ver lista.
3. SQL: `SELECT p.code, pm.role FROM crm_demo.projects p JOIN crm_demo.project_members pm ON pm.project_id=p.id JOIN crm_demo.team_members tm ON tm.id=pm.team_member_id WHERE tm.display_name='Ana García'`.

**Resultado esperado**:
- Datos cuadran (Ana es lead de PRY-2026-0001 y miembro/viewer en
  otros).

**Resultado real**: Pendiente UI — sección Proyectos del drawer en `/equipo`. La SQL de cuadre se puede correr en cualquier momento (`SELECT p.code, pm.role FROM crm_demo.projects p JOIN crm_demo.project_members pm ON pm.project_id=p.id JOIN crm_demo.team_members tm ON tm.id=pm.team_member_id WHERE tm.display_name='Ana García'`). Verificación del render queda para Jorge.
**Bug detectado**: Pendiente.

---

### TC-091. Conversión Lead → Cliente → factura → cobro → ver resumen en /clientes/[id]

**Módulo**: cross-module (leads × clients × billing)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. Crear cliente nuevo "QA Cross" con datos fiscales.
2. Vincular un lead al cliente (PATCH `/api/leads/<id>` con `clientId`).
3. Crear factura para el cliente, emitirla.
4. Registrar cobro total.
5. Ir a `/clientes/QA Cross`.

**Resultado esperado**:
- En la sección Facturación: Facturado>0, Cobrado=Facturado,
  Pendiente=0.
- Lead aparece vinculado.

**Resultado real**: OK por API.
- Cliente "QA Cross" creado con `POST /api/clients`. NOTA importante: el POST del endpoint NO acepta los campos fiscales (`fiscalName/taxId/fiscalAddress/fiscalCity/fiscalZip`); hay que crear el cliente sin ellos y luego `PUT /api/clients/<id>` con los datos fiscales completos (es el mismo hallazgo que en TC-014: no hay UI para datos fiscales, ahora confirmado también en la API POST).
- Factura por 200 € (1 línea, IVA 0%) emitida → `F-2026-0018` issued.
- Cobro de 200 € registrado → status `paid`.
- `GET /api/clients/<id>/billing-summary?from=2026-01-01&to=2026-12-31` → `billedBase=200, collectedBase=200, pendingCollection=0, invoiceCount=1, margin=200, marginPct=100`. Cuadra ✓.
- Vinculación lead → cliente: el PATCH `/api/leads/<id>` NO acepta `clientId` (bug TC-092). Sin ese fix, el lead no puede aparecer vinculado por la vía soportada. Verificable manipulando BD directamente.
**Bug detectado**: 🔴 cruzado con TC-014: el POST de cliente debería aceptar campos fiscales. 🟠 cruzado con TC-092: PATCH /api/leads no acepta `clientId`.

---

### TC-092. Conversión Lead → Proyecto: clientId del lead pasa al proyecto

**Módulo**: cross-module (leads × projects)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. Crear lead vinculado a un cliente (PATCH con `clientId`).
2. POST `/api/leads/<id>/convert-to-project`.
3. GET el proyecto creado.

**Resultado esperado**:
- Proyecto tiene `clientId` igual al del lead.
- Lead tiene `convertedProjectId` apuntando al proyecto.

**Resultado real**: PARCIAL + 🟠 BUG.
- Creé un cliente "QA Cross" + un lead "QA TC-092".
- `PATCH /api/leads/<lead_id> -d '{"clientId":"<qa_cross_id>"}'` (admin) → **HTTP 200**.
- SQL de cuadre: `SELECT client_id FROM crm_demo.leads WHERE id='<lead_id>'` → **NULL** ⚠️. El PATCH dice 200 pero no persiste `clientId`.
- `POST /api/leads/<lead_id>/convert-to-project` → HTTP 201, proyecto `PRY-2026-0009`. El proyecto recibe `clientId: null` (porque el lead no tenía ninguno).
- `convertedProjectId` del lead apunta correctamente al proyecto ✓.
**Bug detectado**: 🟠 importante — `app/api/leads/[id]/route.js` no incluye `clientId` en su whitelist `allowed`. Resultado: el campo se silencia. El convert-to-project ya hace lo correcto (`clientId: lead.clientId ?? null`, línea 61 del endpoint), pero como el upstream no permite asignar el `clientId`, queda inalcanzable. Fix: añadir `"clientId"` al array `allowed` del PATCH.

---

### TC-093. Cambio de hourlyCost se refleja en /api/billing/analytics/employees

**Módulo**: cross-module (team × billing)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. GET `/api/billing/analytics/employees?from=...&to=...`. Anotar
   coste para Ana García.
2. PATCH /api/team/<id_ana> con `{hourlyCost: 99.99}`.
3. GET de nuevo.

**Resultado esperado**:
- Cambio inmediato (no requiere job/cron).

**Resultado real**: N/A — el endpoint `/api/billing/analytics/employees` NO devuelve hoy el campo `hourlyCost` ni un coste derivado de horas. El campo `salaryCost` viene de `SUM(costs.tax_base)` para `type='salary'`, no de `hourlyCost × horas`. Cambié `hourlyCost` de Ana a 99.99 y los KPIs del endpoint no cambiaron (correcto: la lógica actual no depende de `hourlyCost`). Restauré a 30. Si en el futuro se añade un cálculo basado en `hourlyCost`, este TC volverá a tener sentido. Verificación en la columna "Coste/h" del listado de `/equipo` queda para Jorge.
**Bug detectado**: ninguno; revisar la formulación del TC.

---

### TC-094. Cambio de monthlySalary recalcula projectedSalaryCost

**Módulo**: cross-module (team × billing)
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. GET `/api/billing/analytics/employees?from=2026-01-01&to=2026-12-31`.
   Anotar `projectedSalaryCost` para Ana.
2. PATCH `monthlySalary` de Ana a 4000.
3. GET de nuevo.

**Resultado esperado**:
- `projectedSalaryCost = 4000 × monthsBetween(from, to)` ≈ 4000 × 12 ≈ 48.000.
- Sin `+1` inclusivo (bug histórico no debe reaparecer).

**Resultado real**: OK.
- Antes (monthlySalary=3000): `projectedSalaryCost=35880`. Es decir, `monthsBetween(2026-01-01, 2026-12-31) = 35880/3000 = 11.96`.
- Tras `PATCH /api/team/<ana_id> -d '{"monthlySalary":4000}'`: el `GET /api/billing/analytics/employees` muestra `projectedSalaryCost=47840` para Ana.
- 4000 × 11.96 = 47840 ✓. Sin sumar +1 al rango (la regresión histórica no aparece).
- Restauré `monthlySalary=3000` para no dejar el seed alterado.
**Bug detectado**: ninguno.

---

### TC-095. Filtrado de período en /facturacion afecta /analitica/iva, /clientes, /empleados

**Módulo**: cross-module (billing)
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Pasos**:
1. `/facturacion`. Cambiar PeriodPicker a un rango concreto.
2. Navegar a `/facturacion/analitica/iva` → mismo rango.
3. Navegar a `/facturacion/analitica/clientes` → mismo rango.
4. Navegar a `/facturacion/analitica/empleados` → mismo rango.

**Resultado esperado**:
- Periodo persistente entre páginas (vía query string).
- Las 3 analíticas respetan el rango.

**Resultado real**: OK parcial. Las 3 analíticas respetan `?from=&to=` por API (verificado en TC-031, TC-026). La persistencia del periodo entre páginas vía URL query string es comportamiento de navegación del front (Next.js Link/router) — pendiente confirmación visual por Jorge.
**Bug detectado**: ninguno por API.
