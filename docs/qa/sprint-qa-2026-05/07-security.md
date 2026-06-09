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

**Resultado real**: 🔴 BUG (sidebar admin vacío). Verificación: `GET /api/auth/me` con cookie de admin → `enabledModules: []`. El endpoint en `app/api/auth/me/route.js:51-54` solo trata como wildcard si `moduleAccess.length === 0` o `role === "superadmin"`. El literal `"all"` no es wildcard; se intersecta contra `tenantEnabled` (lista de claves de módulo) y como `"all"` no está en esa lista, queda `[]`. Resultado: el admin tiene sidebar vacío. Confirmado contra BD: `master.users` para admin tiene `module_access = ["all"]`. Renderizado del sidebar en navegador pendiente Jorge, pero la causa raíz es la respuesta de `/api/auth/me`. Ver TC-040 para detalle.
**Bug detectado**: 🔴 mismo que TC-040 — tratar `"all"` como wildcard en `app/api/auth/me/route.js`.

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

**Resultado real**: PARCIAL.
- `GET /api/auth/me` con cookie de lead → `enabledModules: ["billing","cuestionarios","leads","projects","team","training"]` (6) ✓.
- `GET /api/auth/me` con cookie de observer → `enabledModules: ["leads","team"]` (2) ✓.
- Sidebar renderizado pendiente confirmación visual por Jorge.
- 🔴 **Bug colateral grave**: el observer (con `moduleAccess=["leads","team"]`) accede vía API a TODO el resto de módulos. Probado `GET /api/billing/invoices` desde cookie observer → **HTTP 200** (no 403). El control de acceso por `moduleAccess` solo se aplica al sidebar (UI), NO a los endpoints. Ver TC-039.
**Bug detectado**: 🔴 cruzado con TC-039 — añadir guard `userHasModule(moduleKey)` en `withTenant`/endpoints o cruzar `enabledModules` con la ruta solicitada.

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

**Resultado real**: 🔴 BUG (cuenta portal NO está restringida). `GET /api/auth/me` con cookie de portal → `enabledModules: ["billing","calendar","clients","cuestionarios","inventory","leads","projects","team","training"]` (9 — todos los módulos activos del tenant demo). En `master.users`, `module_access = []` (literal vacío, no NULL). El código en `app/api/auth/me/route.js:51-54` interpreta `moduleAccess.length === 0` como wildcard "darle todos". Resultado: el sidebar mostrará TODOS los módulos al portal user, y los endpoints lo aceptarán (por el bug cruzado de TC-039). Esto **invalida** la premisa del overview: la cuenta portal NO valida que un usuario `moduleAccess=[]` "NO puede acceder a nada del dashboard interno"; al revés: accede a todo.
**Bug detectado**: 🔴 mismo que TC-040. Fix: distinguir wildcard de "ninguno" — p.ej. `null` o `["all"]` para wildcard, `[]` literal para sin acceso. Hasta entonces, esta TC no es testeable como dice el spec.

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

**Resultado real**: OK. `curl.exe http://localhost:3000/api/auth/me` (sin cookie) → **HTTP 401** `{"ok":false,"error":"No autorizado"}` con header `Cache-Control: no-store`.
**Bug detectado**: ninguno.

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

**Resultado real**: OK.
- `x-tenant: tenant_inexistente_xyz` → **HTTP 404** `"Tenant no encontrado"`.
- `x-tenant: ` (vacío) → **HTTP 404** `"Tenant no encontrado"`.
**Bug detectado**: ninguno.

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

**Resultado real**: OK (auth check). `GET /api/external/retorika/cursos`:
- Sin header `x-api-key` → **HTTP 401** `"No autorizado"`.
- Con `x-api-key: wrong` → **HTTP 401** `"No autorizado"`.
La validación de auth funciona antes de cualquier query al schema, así que es testeable en local aunque `crm_retorika` no exista. Validación contra producción con API key real queda para deploy.
**Bug detectado**: ninguno.

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

**Resultado real**: 🟠 NO hay rate limiting. Loop de 50 POSTs a `/api/public/leads` con bodies distintos (`email=rate-N@test.local`) → las 50 respondieron **HTTP 201**. Cero respuestas 429. Confirma el bug del backlog: vector DoS / spam de leads abierto. Mitigaciones planteadas: rate limit por IP, captcha en formularios públicos, cola n8n con throttling. Limpieza ejecutada: `DELETE FROM crm_demo.leads WHERE email LIKE 'rate-%@test.local'` (50 filas borradas).
**Bug detectado**: 🟠 importante — implementar rate limiting en `/api/public/leads` antes de exponer el formulario en producción para tenants nuevos.

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

**Resultado real**: OK. SQL: `SELECT id, code FROM crm_aumenta.projects` → `3fb37891-...` (PRY-2026-0001 de aumenta). `curl.exe -b /tmp/admin.txt http://localhost:3000/api/projects/3fb37891-...` (cookie admin del tenant demo) → **HTTP 404** `"Proyecto no encontrado"`. El proyecto no se filtra a través del schema (los schemas PostgreSQL aíslan por defecto y `withTenant` resuelve el contexto del JWT).
**Bug detectado**: ninguno. Aislamiento por schema verificado.

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

**Resultado real**: OK. `curl.exe -b /tmp/lead.txt -X POST http://localhost:3000/api/team -H "x-user-role: admin" -d '{"displayName":"Hack"}'` → **HTTP 403** `"Solo admin puede crear miembros"`. El middleware ignora el header forjado y reinserta el rol real (`user`) leído del JWT firmado.
**Bug detectado**: ninguno.

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

**Resultado real**: OK.
- Cookie `auth_token=garbage.invalid.jwt` → **HTTP 401** `"No autorizado"`. Sin stack trace, sin info sensible.
- Cookie `auth_token=notajwt` (sin estructura JWT válida) → **HTTP 401** `"No autorizado"`.
**Bug detectado**: ninguno. (Verificación de cookie con `exp` manualmente forzado en jwt.io requiere navegador; los dos casos básicos cubren la lógica.)

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

**Resultado real**: Pendiente — requiere esperar a que caduque el access token o manipular tiempos. Probable verificación: bajar `JWT_TTL` a 30s en `.env.local`, login, esperar 35s, GET `/api/auth/me`. Verificación de la rotación de refresh queda para Jorge en navegador.
**Bug detectado**: Pendiente.

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

**Resultado real**: **N/A — portal pendiente**. `GET /api/portal` y `GET /api/portal/whatever` → **HTTP 401** (no 404). El middleware de auth intercepta antes de comprobar si la ruta existe. No hay endpoint en código (`find app/api/portal -type f` → vacío). Cuando se implemente el módulo #17 Portal Cliente, este TC se reactiva. Riesgo colateral: la cookie `portal@demo.salamandra` HOY accede al dashboard interno (ver TC-098) — el aislamiento del portal está en deuda crítica.
**Bug detectado**: 🔴 cruzado con TC-098/TC-040 — la cuenta portal abre todo el dashboard interno hoy. Sin el fix del wildcard `moduleAccess=[]`, el portal cliente futuro nacerá con un agujero por defecto.
