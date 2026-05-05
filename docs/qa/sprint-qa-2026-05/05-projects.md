# 05 — Proyectos (Sprint 1)

19 TCs (TC-067 a TC-085). Cubre el módulo `projects` Sprint 1.
**Sprint 2 aún no se ha hecho**: NO probar Tareas / Kanban más allá
del placeholder de pestaña. Documentación detallada del módulo
**pendiente** (no hay aún `docs/modules/projects.md`); estos TCs se
basan en el código real (`app/api/projects/`, `models/tenant/Project*.js`,
`lib/projects/`, `app/(dashboard)/proyectos/`).

---

### TC-067. Listado /proyectos con filtros y búsqueda

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed: 4 proyectos, 2 plantillas).

**Pasos**:
1. Login admin. Ir a `/proyectos`.
2. Verificar las 4 filas: PRY-2026-0001 (active), 0002 (paused), 0003
   (completed), 0004 (draft).
3. Filtrar por status. Verificar conteos.
4. Buscar por code `PRY-2026-0001` o por name.

**Resultado esperado**:
- 4 proyectos visibles con sus columnas (code, name, status,
  priority, dueDate, lead, members count).
- Filtros y búsqueda funcionales.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-068. budgetAmount filtrado por rol en backend

**Módulo**: projects
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin, lead, observer

**Precondiciones**: TC-067.

**Pasos**:
1. admin → GET `/api/projects` → ver `budgetAmount` en cada proyecto.
2. lead@demo (que NO es lead de los proyectos del seed, salvo si está
   vinculado a Ana García) → GET `/api/projects` → verificar que
   solo aparece `budgetAmount` en los proyectos donde es lead.
3. observer → GET `/api/projects` → `budgetAmount` ausente en todos.

**Resultado esperado**:
- admin: budgetAmount visible en todos.
- lead: budgetAmount solo en proyectos donde es lead (Set
  `leadProjectIds`). En el resto, AUSENTE.
- observer: budgetAmount AUSENTE en todos.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-069. Crear proyecto desde drawer con code autogenerado

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. `/proyectos` → "+ Nuevo proyecto".
2. Rellenar name, dejar code vacío. Guardar.

**Resultado esperado**:
- 201, code autogenerado tipo `PRY-2026-0005`.
- BoardColumns por defecto creadas (4).
- Proyecto aparece en el listado.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-070. Crear proyecto sin nombre: rechazo

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. POST `/api/projects` con `{}` (sin name).
2. POST con `name: "  "` (whitespace).

**Resultado esperado**:
- HTTP 400 / 422 "El campo 'name' es obligatorio".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-071. Crear proyecto con dueDate < startDate: rechazo

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. POST `/api/projects` con `name=X, startDate=2026-06-01, dueDate=2026-05-01`.

**Resultado esperado**:
- HTTP 400 / 422 "dueDate debe ser >= startDate".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-072. Detalle /proyectos/[id] con 6 pestañas

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-067.

**Pasos**:
1. Click en PRY-2026-0001.
2. Verificar 6 pestañas: Resumen, Equipo, Fases, Hitos, Tablero
   (placeholder Sprint 2), Configuración.
3. Cargar cada pestaña.

**Resultado esperado**:
- Resumen: KPIs del proyecto, descripción, cliente.
- Equipo: 3 miembros con roles (lead/member).
- Fases: 4 fases en orden, con colores.
- Hitos: 3 hitos.
- Tablero: placeholder "Sprint 2 pendiente" o similar.
- Configuración: form de edición para admin/lead.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-073. Edición de proyecto por admin: permitido

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. PATCH `/api/projects/<id>` con `{description:"editado"}`.

**Resultado esperado**:
- 200, descripción persistida.
- AuditLog: `project.updated` con before/after.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-074. Edición de proyecto por LEAD del proyecto: permitida

**Módulo**: projects
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead (user)

**Precondiciones**: El user `lead@demo` debe tener un TeamMember y
ser lead del proyecto. Esto requiere setup manual:
1. SQL: `UPDATE crm_demo.team_members SET user_id=(SELECT id FROM master.users WHERE email='lead@demo.salamandra') WHERE display_name='Carlos López'` (Carlos es lead del PRY-2026-0002).

**Pasos**:
1. Login `lead@demo`.
2. PATCH `/api/projects/<PRY-2026-0002>` con `{description:"editado por lead"}`.

**Resultado esperado**:
- 200.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-075. Edición por user no-admin que NO es lead: 403

**Módulo**: projects
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead (user con TeamMember pero no lead del proyecto)

**Precondiciones**: TC-074 (lead@demo vinculado a Carlos = lead de
PRY-2026-0002, NO de 0001).

**Pasos**:
1. Login `lead@demo`.
2. PATCH `/api/projects/<PRY-2026-0001>` con `{description:"x"}`.

**Resultado esperado**:
- HTTP 403 "Solo administradores o el lead del proyecto pueden modificarlo".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-076. Admin sin TeamMember: bypass funciona

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Crear un admin nuevo SIN TeamMember asociado
(SQL: `INSERT INTO master.users(...) VALUES (...,role='admin'...)`
sin vincularlo a ningún TeamMember en demo).

**Pasos**:
1. Login con ese admin.
2. PATCH cualquier proyecto.

**Resultado esperado**:
- 200, edita sin importar que no tenga perfil de equipo.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-077. Soft delete (archivedAt) — listado por defecto excluye

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. DELETE `/api/projects/<PRY-2026-0004>`.
2. GET `/api/projects` (sin params).
3. GET `/api/projects?includeArchived=true`.

**Resultado esperado**:
- (1): 204, `archivedAt` se setea.
- (2): el proyecto NO aparece.
- (3): SÍ aparece.
- AuditLog: `project.archived`.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-078. Estado completed: completedAt se autoseta vía hook

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. PATCH `/api/projects/<id_active>` con `{status:"completed"}` (sin
   completedAt).
2. GET el proyecto.

**Resultado esperado**:
- `completedAt` automáticamente seteado a NOW (hook beforeUpdate).
- Si se manda completedAt explícito, prevalece.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-079. BoardColumn: no permitir borrar la última, ni si tiene tasks

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. GET `/api/projects/<id>/columns`. Debería haber 4.
2. DELETE 3 columnas.
3. DELETE la 4ª (última).
4. (Opcional) crear una task en una columna y luego borrar la columna.

**Resultado esperado**:
- (3): 400/422 "No se puede borrar la última columna del tablero".
- (4): 400/422 si tiene tasks: "La columna tiene N tarea(s). Muévelas
  antes de borrar".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-080. BoardColumn isDoneColumn única por proyecto

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. PATCH columna A con `{isDoneColumn: true}` (la "Hecho" del seed ya
   lo tiene).
2. PATCH columna B con `{isDoneColumn: true}`.
3. GET `/api/projects/<id>/columns`.

**Resultado esperado**:
- Tras (2): solo columna B tiene `isDoneColumn=true`. La A pasó a
  false automáticamente.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-081. Conversión Lead → Proyecto desde el botón

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Un lead sin convertir.

**Pasos**:
1. Drawer de un lead libre. Botón "Convertir a proyecto".
2. Confirmar.

**Resultado esperado**:
- POST `/api/leads/<id>/convert-to-project` → 201.
- Proyecto creado con name=lead.title o lead.name.
- Lead actualizado con `convertedProjectId` y stage = `won` (si no
  era terminal positivo).

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-082. ProjectMember: añadir teamMember inactivo — comportamiento

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Pasos**:
1. POST `/api/projects/<id>/members` con `teamMemberId` de Sara Romero
   (status=inactive).
2. Verificar respuesta.

**Resultado esperado**:
- Probablemente permitido (no documentado bloqueo). Documentar.
- Si la UI filtra inactivos en el selector, anotar.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-083. Plantillas: CRUD solo admin

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin, lead

**Pasos**:
1. admin: GET `/api/project-templates` → 2 plantillas del seed.
2. admin: POST nueva plantilla → 201.
3. admin: PATCH/PUT plantilla → 200.
4. admin: DELETE → 204.
5. lead: POST/PATCH/DELETE → 403.

**Resultado esperado**:
- admin: CRUD completo.
- lead: 403 en mutaciones, 200 en GET.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-084. Sección embebida en /clientes/[id] muestra proyectos del cliente

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: PRY-2026-0001 vinculado al cliente del seed.

**Pasos**:
1. `/clientes` → click en el cliente vinculado a PRY-2026-0001.
2. Ver sección "Proyectos del cliente".

**Resultado esperado**:
- Lista los proyectos del cliente.
- GET `/api/clients/<id>/projects` devuelve los proyectos correctos.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-085. /api/projects sin módulo activo en el tenant: 403

**Módulo**: projects
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Pasos**:
1. SQL: `UPDATE master.tenant_modules SET enabled=false
   WHERE module_key='projects' AND tenant_id=(SELECT id FROM master.tenants WHERE slug='demo')`.
2. Esperar invalidación cache (60s) o reiniciar dev.
3. GET `/api/projects`.
4. Restaurar.

**Resultado esperado**:
- 403 "Forbidden" mientras el módulo está desactivado.
- 200 tras restaurar.

**Resultado real**: ⏳
**Bug detectado**: ⏳
