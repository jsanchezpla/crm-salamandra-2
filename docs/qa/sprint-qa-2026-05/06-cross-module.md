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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳
