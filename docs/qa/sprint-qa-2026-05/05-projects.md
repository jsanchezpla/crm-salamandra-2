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

**Resultado real**: Pendiente UI — lista y filtros en `/proyectos`. Verificable solo en navegador por Jorge. Por API: `GET /api/projects` devuelve los 4 del seed + los creados por conversiones de lead en TC-049/092 + el creado en TC-069 (total ~9 ahora). Los códigos `PRY-2026-NNNN` se autogeneran correctamente.
**Bug detectado**: Pendiente.

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

**Resultado real**: OK.
- admin: `GET /api/projects` muestra `budgetAmount` en todos los proyectos (valor numérico cuando el seed lo tiene, `null` cuando no).
- lead@demo (sin TeamMember vinculado en BD: `team_members.user_id` para `lead@demo.salamandra` es `NULL`): NO ve `budgetAmount` en NINGÚN proyecto (clave ausente del JSON, no `null`). Esto es coherente porque `leadProjectIds` queda vacío y el endpoint omite la clave.
- observer: NO ve `budgetAmount` en ningún proyecto ✓.
**Bug detectado**: ninguno. ℹ️ Para probar el caso "lead@demo vinculado a un TeamMember que sea lead de un proyecto" hay que correr el setup SQL de TC-074 (no ejecutado aquí porque deja estado divergente respecto al reset).

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

**Resultado real**: OK. `POST /api/projects -d '{"name":"QA Project TC-069"}'` → **HTTP 201**, `code="PRY-2026-0008"` (correlativo siguiente al tras los 7 ya creados por seed + conversiones), status `draft` (sin cliente vinculado). `GET /api/projects/<id>/columns` → 4 columnas auto-creadas: "Por hacer" (order=0, color #94A3B8), "En curso" (order=1, color #3B82F6), "En revisión" (order=2), "Hecho" (order=3, isDoneColumn=true). El proyecto aparece en `GET /api/projects`.
**Bug detectado**: ninguno.

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

**Resultado real**: OK.
- `POST /api/projects -d '{}'` → **HTTP 422** `"El campo 'name' es obligatorio"`.
- `POST /api/projects -d '{"name":"   "}'` → **HTTP 422** mismo mensaje (trim aplicado).
**Bug detectado**: ninguno.

---

### TC-071. Crear proyecto con dueDate < startDate: rechazo

**Módulo**: projects
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. POST `/api/projects` con `name=X, startDate=2026-06-01, dueDate=2026-05-01`.

**Resultado esperado**:
- HTTP 400 / 422 "dueDate debe ser >= startDate".

**Resultado real**: OK. `POST /api/projects -d '{"name":"QA TC-071","startDate":"2026-06-01","dueDate":"2026-05-01"}'` → **HTTP 422** `"dueDate debe ser >= startDate"`.
**Bug detectado**: ninguno.

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

**Resultado real**: Pendiente UI — pestañas, renderizado y placeholder Sprint 2. Verificable solo en navegador por Jorge.
**Bug detectado**: Pendiente.

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

**Resultado real**: OK. `PATCH /api/projects/<PRY-2026-0008> -d '{"description":"editado por admin"}'` (admin) → **HTTP 200**. La descripción se persiste. AuditLog no inspeccionado en esta pasada (revisable con `SELECT action, before, after FROM master.audit_log WHERE entity='Project' ORDER BY created_at DESC LIMIT 5`).
**Bug detectado**: ninguno.

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

**Resultado real**: Pendiente — requiere setup SQL destructivo del seed (linkar `lead@demo.salamandra` a Carlos López como `user_id`). No ejecutado para mantener el estado del reset estable durante la batería QA. Reproducible manualmente con: `UPDATE crm_demo.team_members SET user_id=(SELECT id FROM master.users WHERE email='lead@demo.salamandra') WHERE display_name='Carlos López';` y después el PATCH.
**Bug detectado**: Pendiente.

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

**Resultado real**: OK. Sin necesitar el setup de TC-074 (lead@demo no tiene TeamMember vinculado), `curl.exe -b /tmp/lead.txt -X PATCH /api/projects/<PRY-2026-0008> -d '{"description":"editado por lead no autorizado"}'` → **HTTP 403** `"Solo administradores o el lead del proyecto pueden modificarlo"`. La descripción no se modifica.
**Bug detectado**: ninguno.

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

**Resultado real**: Pendiente — requiere crear un user admin nuevo en `master.users` sin TeamMember, lo que altera el seed permanente. No ejecutado en esta pasada. Verificación cubierta indirectamente por TC-073 (admin con TeamMember edita OK; el guard mira `role==='admin'` antes de comprobar `leadProjectIds`, así que un admin sin TeamMember pasaría el mismo path).
**Bug detectado**: Pendiente.

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

**Resultado real**: OK. Probado sobre PRY-2026-0008:
- `DELETE /api/projects/<PRY-2026-0008>` → **HTTP 204**. BD: `archived_at IS NOT NULL`.
- `GET /api/projects` (sin params) → NO contiene el id ✓.
- `GET /api/projects?includeArchived=true` → SÍ contiene el id ✓.
**Bug detectado**: ninguno.

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

**Resultado real**: OK. `PATCH /api/projects/<active_id> -d '{"status":"completed"}'` (sin enviar `completedAt`) → respuesta contiene `"status":"completed"` y `"completedAt":"2026-06-09T09:03:00.942Z"` (auto-seteado por el hook). El caso "completedAt explícito prevalece" no se forzó en esta pasada (lógica de `beforeUpdate` confirma que solo setea si está vacío).
**Bug detectado**: ninguno.

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

**Resultado real**: OK parcial.
- `GET /api/projects/<PRY-2026-0007>/columns` → 4 columnas iniciales.
- `DELETE` de 3 columnas seguidas → **HTTP 204** las 3.
- `DELETE` de la 4ª (última) → **HTTP 422** `"No se puede borrar la última columna del tablero"` ✓.
- El test "columna con tasks" no se forzó en esta pasada porque el sprint 2 (tasks/kanban) está aún sin implementar; no hay endpoint para crear tareas. Verificable cuando exista.
**Bug detectado**: ninguno funcional.

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

**Resultado real**: OK. Probado sobre PRY-2026-0006 (`Roberto Fuentes Méndez`):
- PATCH col A (`isDoneColumn:true`) → HTTP 200, A queda en true.
- PATCH col B (`isDoneColumn:true`) → HTTP 200, B queda en true.
- `GET /api/projects/<id>/columns` final → exactamente 1 columna con `isDoneColumn:true` (B); A volvió a false automáticamente. El resto (4 columnas en total) tienen `isDoneColumn:false`.
**Bug detectado**: ninguno. La unicidad de `isDoneColumn` por proyecto está garantizada por la lógica del PATCH (no por constraint en BD).

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

**Resultado real**: OK por API (cubierto exhaustivamente en TC-049). Pendiente verificar el flujo desde el botón del drawer en UI — Jorge.
**Bug detectado**: ninguno por API.

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

**Resultado real**: OK — comportamiento documentado. `POST /api/projects/<PRY-2026-0006>/members -d '{"teamMemberId":"<sara_romero_inactive>","role":"member"}'` (admin) → **HTTP 201**. El backend NO bloquea añadir empleados inactivos. La UI puede (debería) filtrarlos en el selector — no verificado en esta pasada porque requiere abrir el drawer; pendiente Jorge.
**Bug detectado**: ninguno funcional. ℹ️ Decisión pendiente: ¿bloquear en backend o solo en frontend?

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

**Resultado real**: OK.
- admin GET `/api/project-templates` → 200, 2 plantillas del seed.
- admin POST → **HTTP 201**, plantilla creada. ⚠️ El body acepta `boardColumns`/`phases`/`defaultMilestones`/`defaultTags`; las pruebas con `columns` no rellenan (campo no reconocido), recomendable normalizar el nombre.
- admin PATCH → **HTTP 200**, `name` actualizado.
- admin DELETE → **HTTP 204**.
- lead GET → **HTTP 200** (lectura permitida).
- lead POST/PATCH → **HTTP 403** `"Solo administradores pueden gestionar plantillas de proyecto"`.
**Bug detectado**: 🟡 menor — el TC dice payload con `columns`, el endpoint espera `boardColumns`. Actualizar el TC y/o normalizar el nombre de campo.

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

**Resultado real**: Pendiente UI — sección embebida en `/clientes/[id]`. Solo verificable en navegador. La API está implementada (`/api/clients/[id]/projects`), pero el render dentro de la ficha de cliente queda para Jorge.
**Bug detectado**: Pendiente.

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

**Resultado real**: OK.
- SQL `UPDATE master.tenant_modules SET enabled=false WHERE module_key='projects' AND tenant_id=(SELECT id FROM master.tenants WHERE slug='demo')`.
- Inmediato: `GET /api/projects` → HTTP 200 (cache del tenant context aún caliente; TTL 60s).
- Tras esperar ≥60s: `GET /api/projects` → **HTTP 403** `"Forbidden"` (o equivalente del endpoint).
- SQL restore `enabled=true`. Tras esperar ≥60s: `GET /api/projects` → **HTTP 200** ✓.
**Bug detectado**: ninguno funcional. ℹ️ Operativo: cambios en `tenant_modules` no se propagan en runtime; toca esperar ~1 min o exponer endpoint admin que llame a `invalidateTenantCache(slug)`. Mismo hallazgo que TC-055.
