# 01 — Equipo & RRHH

13 TCs. Cubre el módulo `team`. Documentación de referencia:
`docs/modules/team.md`.

---

### TC-001. Listado base muestra los 5 empleados sembrados

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**:

- Reset ejecutado.

**Pasos**:

1. Login como `admin@demo.salamandra`.
2. Ir a `/equipo`.
3. Verificar que aparecen 4 empleados activos (Ana García, Carlos
   López, Laura Martínez, Miguel Sánchez) y que Sara Romero NO sale
   (filtro por defecto excluye `inactive`).
4. Cambiar filtro a "Todos" y verificar que Sara Romero aparece.

**Resultado esperado**:

- Filtro por defecto: 4 activos.
- Filtro "Todos": 5 (incluye Sara Romero `inactive`).
- Columnas Coste/h, Tarifa/h y Salario mensual visibles para admin.

**Resultado real**: OK
**Bug detectado**: Ninguno

---

### TC-002. Alta de empleado vacío (solo displayName) y completo

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Botón "+ Añadir empleado".
2. Caso A: rellenar solo `displayName = "QA Empleado vacío"` y guardar.
3. Caso B: nuevo alta con todos los campos rellenos
   (`displayName`, role, department, email, phone, hourlyCost,
   hourlyRate, monthlySalary, startDate, status, notes).
4. Verificar que ambos aparecen en el listado.

**Resultado esperado**:

- A: 201, miembro creado solo con displayName, resto null.
- B: 201, miembro completo, todos los campos persistidos.

**Resultado real**: OK, pero la tabla de equipo no se ve bien en móvil porque hay que hacer scroll horizonatl en móvil y es más incómodo
**Bug detectado**: Ninguno

---

### TC-003. Edición de campos sensibles por admin

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Click en Ana García → drawer.
2. Editar → cambiar `hourlyCost` de 22.5 a 30 y `monthlySalary` de
   2400 a 3000. Guardar.
3. Recargar y reabrir el drawer.

**Resultado esperado**:

- Cambios persistidos.
- En `master.AuditLog` aparecen `team.cost_changed` y
  `team.salary_changed` con before/after correctos.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-004. Lead (user no-admin) NO puede editar campos sensibles

**Módulo**: team
**Severidad esperada del bug si falla**: 🔴 crítico (defensa en profundidad)
**Rol necesario**: lead

**Precondiciones**: TC-001.

**Pasos**:

1. Logout. Login como `lead@demo.salamandra`.
2. Ir a `/equipo`.
3. Intentar `PATCH /api/team/<id>` con curl o devtools, payload
   `{ "hourlyCost": 999 }`.

**Resultado esperado**:

- UI: el botón "Editar" no aparece (sin admin).
- API: HTTP 403 "Solo administradores pueden modificar este recurso".
- En BD el valor sigue siendo el anterior.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-005. Observer no ve hourlyCost ni monthlySalary

**Módulo**: team
**Severidad esperada del bug si falla**: 🔴 crítico (RGPD/sensible)
**Rol necesario**: observer

**Precondiciones**: TC-001.

**Pasos**:

1. Login como `observer@demo.salamandra`.
2. Ir a `/equipo`.
3. Verificar columnas visibles del listado.
4. Click en una fila → drawer.
5. En devtools, abrir Network y mirar el JSON de `/api/team` y
   `/api/team/[id]`.

**Resultado esperado**:

- UI: NO se ve columna Coste/h ni Salario mensual.
- JSON: los campos `hourlyCost` y `monthlySalary` están AUSENTES (no
  null, ausentes — el serializer los borra).
- `hourlyRate` SÍ se ve.

**Resultado real**: OK, igual que el usuario lead@demo.salamandra
**Bug detectado**: NO

---

### TC-006. Soft delete (DELETE → status=inactive) y filtros del listado

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-002 (caso A "QA Empleado vacío" creado).

**Pasos**:

1. Login admin. Drawer del empleado "QA Empleado vacío".
2. Botón "Desactivar" → confirmar.
3. Verificar UI: desaparece del filtro por defecto, aparece en "Todos"
   con badge "Inactivo".
4. DELETE de nuevo: debe ser idempotente (HTTP 204 o similar sin
   tocar nada).

**Resultado esperado**:

- 1ª llamada: status pasa a `inactive`.
- 2ª llamada: 204 idempotente.
- En `master.AuditLog`: `team.deactivated`.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-007. Vinculación userId↔TeamMember única

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Ana García ya está vinculada al User admin.
2. Editar Carlos López. Asignarle el mismo `userId` (el del admin).

**Resultado esperado**:

- HTTP 409 con mensaje "El user ya está vinculado a otro miembro".
- O: HTTP 400 / 422 explicando el conflicto.
- Ana García sigue vinculada.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-008. Email único: duplicado devuelve 409

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Crear empleado con `email = "ana.garcia@demo.local"` (mismo que Ana).
2. Capturar respuesta.

**Resultado esperado**:

- HTTP 409 "Ya existe un miembro con ese email".

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-009. Email vacío vs null se normaliza a NULL

**Módulo**: team
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Crear empleado A con `email = ""` (string vacío).
2. Crear empleado B con `email = "   "` (espacios).
3. Crear empleado C sin enviar `email` en el body.

**Resultado esperado**:

- Los 3 se crean con éxito (varios NULL coexisten en el UNIQUE).
- En BD: `email` es `NULL` en los 3 (no string vacío).

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-010. Estado on_leave NO seleccionable en form, sí renderizado si llega de BD

**Módulo**: team
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Abrir form de "Nuevo empleado".
2. Verificar que el desplegable "Estado" ofrece solo `active` e
   `inactive`.
3. Vía SQL directo: `UPDATE crm_demo.team_members SET status='on_leave'
WHERE display_name='Miguel Sánchez'`.
4. Recargar `/equipo`. Abrir el drawer de Miguel.
5. En el form de edición, el desplegable debe incluir `on_leave` solo
   por estar el empleado actualmente en ese estado.

**Resultado esperado**:

- Listado: badge "De baja" (ámbar) en Miguel.
- Form: opción `on_leave` visible y seleccionable.
- Crear empleado nuevo desde cero: sigue sin ofrecer `on_leave`.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-011. Búsqueda con debounce ~300ms

**Módulo**: team
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Escribir rápidamente "Lau" en el cuadro de búsqueda.
2. Observar Network: solo se debe disparar 1 request a `/api/team?q=Lau`,
   no 3.

**Resultado esperado**:

- Solo 1 request tras un breve delay.
- Tras teclear, los resultados se filtran a Laura Martínez.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-012. Filtro por rol dinámico (availableRoles)

**Módulo**: team
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Verificar que el filtro de "Rol" muestra exactamente los valores
   presentes ("Empleado Senior", "Empleado Junior").
2. Crear un empleado con role "Comercial".
3. Verificar que el desplegable se actualiza para incluir "Comercial".

**Resultado esperado**:

- `availableRoles` se actualiza dinámicamente desde la respuesta del
  listado.

**Resultado real**: OK
**Bug detectado**: NO

---

### TC-013. AuditLog: cambio de role/estado deja huella

**Módulo**: team
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-001.

**Pasos**:

1. Editar Carlos López → cambiar `role` a "Empleado Junior". Guardar.
2. Editar Carlos López → cambiar `status` a `inactive`. Guardar.
3. SQL: `SELECT action, before, after FROM master.audit_log
WHERE entity='TeamMember' ORDER BY created_at DESC LIMIT 5`.

**Resultado esperado**:

- 2 entradas: `team.role_changed` y `team.status_changed` (más
  posiblemente `team.deactivated` por el DELETE soft).
- before/after con los valores cambiados.

**Resultado real**: OK
**Bug detectado**: NO
