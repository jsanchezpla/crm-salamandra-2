# 07 — Seguridad y aislamiento

12 TCs (TC-096 a TC-107). Cubre seguridad, autenticación, aislamiento
multi-tenant.

---

### TC-096. Login admin: ve todos los módulos en sidebar

**Módulo**: security
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. Login `admin@demo.salamandra`.
2. Verificar sidebar.

**Resultado esperado**:
- Todas las secciones visibles según `enabledModules` (intersección
  módulos activos del tenant ∩ moduleAccess del user).
- admin con `moduleAccess=["all"]` ve todo lo activo.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-097. User con módulos limitados: solo ve esos módulos

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead, observer

**Pasos**:
1. Login `lead@demo`.
2. Verificar sidebar: solo leads, team, projects, billing, training,
   cuestionarios.
3. Login `observer@demo`.
4. Verificar sidebar: solo leads y team.

**Resultado esperado**:
- lead: 6 secciones.
- observer: 2 secciones.
- Resto NO aparece. Acceso directo por URL → 403.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-098. Login portal user: NO debe ver dashboard interno

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: portal

**Precondiciones**: `portal@demo.salamandra` creada con
moduleAccess=[].

**Pasos**:
1. Login `portal@demo`.
2. Intentar acceder a `/equipo`, `/leads`, `/facturacion`, `/proyectos`,
   `/formacion`.

**Resultado esperado**:
- Cada URL: 403 o redirect a un placeholder.
- Sidebar vacío o con mensaje "Sin módulos disponibles".
- Login funciona pero la app es inutilizable (es lo correcto: el
  portal cliente #17 aún no existe).

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-099. /api/auth/me sin cookie: 401

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público

**Pasos**:
1. Logout o usar nueva sesión.
2. GET `/api/auth/me` sin cookie.

**Resultado esperado**:
- HTTP 401.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-100. Endpoints públicos con tenant inválido en x-tenant

**Módulo**: security
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: público

**Pasos**:
1. POST `/api/public/leads` con `x-tenant: tenant_inexistente_xyz`.
2. POST con `x-tenant:` vacío.

**Resultado esperado**:
- 404 "Tenant no encontrado".
- Header `x-tenant` vacío: 400 / 404.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-101. Endpoints externos sin API key: 401

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público

**Pasos**:
1. GET `/api/external/retorika/cursos` sin header `x-api-key`.
2. GET con header pero key incorrecta.

**Resultado esperado**:
- Ambos: 401.
- En local probablemente N/A (no existe schema retorika); marcar.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-102. Rate limiting en /api/public/leads (¿existe?)

**Módulo**: security
**Severidad esperada del bug si falla**: 🟠 importante (documentado backlog)
**Rol necesario**: público

**Pasos**:
1. Loop bash: 50 POSTs seguidos a `/api/public/leads` con body
   distinto cada vez.

**Resultado esperado**:
- Si NO hay rate limiting: las 50 se aceptan (bug documentado).
- Si SÍ hay: alguna respuesta 429.
- Anotar el comportamiento real para alimentar el backlog.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-103. Aislamiento entre tenants: GET /api/projects/[id] de OTRO tenant

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: admin

**Pasos**:
1. SQL: localizar un id de proyecto en `crm_aumenta` o `crm_quality_energy`.
2. Login admin de demo.
3. GET `/api/projects/<id_de_otro_tenant>`.

**Resultado esperado**:
- 404 (el proyecto NO existe en `crm_demo`, donde busca el tenant
  context resuelto desde la cookie/JWT).
- Nunca debe devolver el proyecto de otro tenant.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-104. Manipular x-user-role en una petición: middleware lo ignora

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead

**Pasos**:
1. Login `lead@demo` (rol user).
2. POST `/api/team` con header forzado `x-user-role: admin` (curl):
   ```
   curl.exe -b /tmp/c.txt -X POST http://localhost:3000/api/team \
     -H "x-user-role: admin" -H "Content-Type: application/json" \
     -d '{"displayName":"Hack"}'
   ```

**Resultado esperado**:
- HTTP 403 "Solo administradores pueden modificar este recurso".
- El middleware sobrescribe `x-user-role` con el del JWT validado.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-105. Token JWT expirado o malformado: 401

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: cualquiera

**Pasos**:
1. Editar la cookie `auth_token` (devtools) y poner un valor basura.
2. GET `/api/auth/me`.
3. Reset cookie expirada (manualmente cambiar `exp` con jwt.io).

**Resultado esperado**:
- Ambos casos: 401.
- Sin stack trace ni info sensible en la respuesta.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-106. Refresh token: funciona correctamente

**Módulo**: security
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: cualquiera

**Pasos**:
1. Login.
2. Esperar a que el access token caduque (o reducirlo manualmente).
3. Hacer una request a `/api/auth/me`.
4. Verificar que se renueva el token (cookie con nuevo `exp`).

**Resultado esperado**:
- Renovación silenciosa.
- Si refresh también caducó: 401 y forzar nuevo login.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-107. Endpoint /api/portal/* aislado del dashboard interno (cuando exista)

**Módulo**: security
**Severidad esperada del bug si falla**: 🔴 crítico (cuando aplique)
**Rol necesario**: portal

**Precondiciones**: Portal aún no implementado.

**Pasos**:
1. GET `/api/portal/*` cualquier ruta.

**Resultado esperado**:
- Hoy: 404 (no existe el endpoint).
- Cuando exista (#17): debe estar aislado del dashboard, sin acceso
  a `/api/team`, `/api/billing`, etc. desde la cookie del portal.
- Marcar este TC como "N/A — portal pendiente".

**Resultado real**: ⏳
**Bug detectado**: ⏳
