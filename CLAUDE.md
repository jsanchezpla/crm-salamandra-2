# CRM SaaS Salamandra Solutions

## Quién soy

Soy Jorge, informático de Salamandra Solutions. Construyo un CRM SaaS
multi-tenant para vender como producto a empresas. Actúas como mi
arquitecto y senior developer de referencia.

---

## Stack técnico

| Capa             | Tecnología                                     |
| ---------------- | ---------------------------------------------- |
| Frontend+Backend | Next.js 16 (App Router + Route Handlers)       |
| Base de datos    | PostgreSQL                                     |
| ORM              | Sequelize                                      |
| Multi-tenant     | Schema por tenant (`crm_{slug}`)               |
| Estilos          | Tailwind CSS 4                                 |
| Despliegue       | VPS propio (Docker)                            |
| Automatizaciones | n8n (instancia propia)                         |
| IA               | API OpenAI                                     |
| Lenguaje         | JavaScript puro (SIN TypeScript)               |

> El proyecto anterior usaba MongoDB + Mongoose + Express. Descartado.

---

## Infraestructura: Local vs Producción

El proyecto tiene DOS entornos completamente separados con bases de datos independientes.

### Entorno local (desarrollo)

- **SO:** Windows 10 (PowerShell)
- **Node:** ejecución directa con `npm run dev`
- **DB:** PostgreSQL local
- **Config:** `.env.local` (gitignored)
- **URL:** `http://localhost:3000`

### Entorno de producción (VPS)

- **Despliegue:** Docker Compose en VPS propio
- **Proxy:** nginx nativo en el VPS (no dockerizado)
- **Config:** `.env.production` en el VPS (gitignored, NUNCA en el repo)
- **Ejemplo de config:** `.env.production.example` (SÍ en el repo)

**Contenedores Docker en producción:**

| Container                | Imagen               | Puerto                 | Descripción                   |
| ------------------------ | -------------------- | ---------------------- | ----------------------------- |
| `crm-salamandra-app-1`   | `crm-salamandra-app` | `127.0.0.1:3000->3000` | App Next.js (producción)      |
| `crm-salamandra-db-1`    | `postgres:16-alpine` | 5432 (interno Docker)  | PostgreSQL del CRM            |
| `n8n`                    | `n8nio/n8n:latest`   | `127.0.0.1:5678->5678` | Motor de automatizaciones     |
| `n8n-postgres`           | `postgres:15-alpine` | 5432 (interno Docker)  | PostgreSQL de n8n (separada)  |

**Los schemas (estructura de tablas) son los mismos porque vienen del código.
Los datos de cada entorno son completamente independientes — no hay sincronización de datos entre local y producción.**

> **Nota sobre tenants:** la lista de tenants en local y en producción NO es necesariamente la misma.
> Algunos tenants viven solo en producción (`retorika`, `abarcaia`) y otros solo en local
> (`spain-enzymes` por ahora). Cualquier script de migración debe leer la lista de schemas a
> procesar desde `master.tenants` en tiempo de ejecución, nunca hardcodearla.

### Flujo de deploy (`deploy.sh`)

El despliegue se ejecuta en el VPS. El script se corre manualmente allí:

1. `git pull` — baja los cambios del repo
2. Detecta si `package.json` o `package-lock.json` cambiaron
3. **Si NO cambiaron deps:** `npm run build` en el host → `docker compose up -d --build --no-deps app`
4. **Si cambiaron deps (o `--full`):** `npm ci` → `npm run build` → `docker compose down` → `docker compose up -d --build`

El build se hace en el VPS host (no dentro de Docker) porque necesita devDependencies (Tailwind, etc.).
El Dockerfile solo copia los artefactos `.next/` ya compilados + deps de producción.

### Dockerfile (producción)

- Base: `node:22-alpine` con herramientas nativas (python3, make, g++) para bcrypt
- Solo copia: `.next/`, `public/`, `lib/`, `models/`, `scripts/`, `next.config.mjs`
- Ejecuta como usuario `nextjs` (sin privilegios)
- `npm ci --omit=dev` (solo deps de producción)

---

## Entorno de desarrollo

- **Editor:** VS Code
- **Linter:** ESLint 9 (flat config) — ver `eslint.config.mjs`
- **Formatter:** Prettier 3 — ver `.prettierrc`
- **Terminal:** PowerShell (Windows) — usar sintaxis PowerShell, no bash

Configuración de VS Code, ESLint y Prettier en sus respectivos ficheros
(`.vscode/settings.json`, `eslint.config.mjs`, `.prettierrc`). No duplicar aquí.

---

## Arquitectura multi-tenant

- Una sola app Next.js para todos los clientes
- Una sola base de datos PostgreSQL: `salamandra`
- Schema `master` con configuración global
- Un schema `crm_{slug}` por cada tenant con sus datos

```
PostgreSQL DB: salamandra
├── schema: master              ← tenants, users, tenant_modules, audit_log
├── schema: crm_demo            ← tenant de desarrollo (local + producción)
├── schema: crm_retorika        ← Retorika (formación) — solo producción
├── schema: crm_quality_energy  ← Quality Energy (leads + referidos)
├── schema: crm_aumenta         ← Aumenta (leads + facturación parcial)
├── schema: crm_abarcaia        ← Abarcaia (leads) — solo producción
└── schema: crm_spain_enzymes   ← Spain Enzymes (leads, clientes, inventario) — solo local por ahora
```

### Motor de personalización por tenant

Cada cliente puede tener, módulo a módulo (tabla `tenant_modules` en `master`):

- `schemaExtensions` (JSONB) — campos extra en el schema
- `logicOverrides` (JSONB) — comportamiento distinto
- `uiOverride` — nombre de componente React alternativo
- `featureFlags` (JSONB) — features en prueba

Al modificar config de un tenant → `invalidateTenantCache(slug)`.

### Personalización visual por tenant

Colores en `tenant.settings.brand` (JSONB): `primaryColor`, `secondaryColor`, `logoUrl`.
Se inyectan como `var(--color-primary)` y `var(--color-secondary)` en el layout del dashboard.
El login de Salamandra usa paleta fija (`#FAFAF8` + `#1B3A2D`).

---

## Estructura de carpetas (REAL — actualizada 2026-04-29)

```
crm-salamandra-2/
│
├── app/
│   ├── layout.js                               ← root layout
│   ├── globals.css
│   ├── (auth)/
│   │   ├── layout.jsx
│   │   └── login/page.jsx
│   ├── (dashboard)/
│   │   ├── layout.jsx
│   │   ├── page.jsx                            ← dashboard home
│   │   ├── clientes/page.jsx
│   │   ├── comercial/leads/page.jsx
│   │   ├── cuestionarios/page.jsx
│   │   ├── facturacion/
│   │   │   ├── page.jsx                        ← overview facturación
│   │   │   ├── analitica/page.jsx
│   │   │   ├── cobros/page.jsx
│   │   │   ├── costes/page.jsx
│   │   │   └── facturas/page.jsx
│   │   ├── formacion/
│   │   │   ├── page.jsx                        ← overview formación
│   │   │   ├── alumnos/page.jsx
│   │   │   ├── cuestionarios/page.jsx
│   │   │   ├── cursos/page.jsx
│   │   │   ├── empresas/page.jsx
│   │   │   ├── empresas/[id]/page.jsx
│   │   │   └── usuarios/page.jsx
│   │   ├── leads/page.jsx
│   │   └── referidos/page.jsx
│   └── api/
│       ├── auth/
│       │   ├── login/route.js
│       │   ├── logout/route.js
│       │   └── refresh/route.js
│       ├── billing/
│       │   ├── analytics/route.js
│       │   ├── analytics/employees/route.js
│       │   ├── costs/route.js  +  [id]/route.js
│       │   ├── invoices/route.js  +  [id]/route.js
│       │   ├── payments/route.js  +  [id]/route.js
│       │   ├── rates/route.js  +  [id]/route.js
│       │   └── recurring/route.js  +  [id]/route.js
│       ├── cuestionarios/
│       │   ├── route.js  +  [id]/route.js
│       │   └── sync/route.js
│       ├── cursos-empresas/codigos-cursos/[email]/route.js
│       ├── external/retorika/
│       │   ├── alumnos/route.js  +  [email]/route.js
│       │   └── cursos/route.js
│       ├── leads/
│       │   ├── route.js  +  [id]/route.js
│       │   ├── export/route.js
│       │   └── import/route.js  +  excel/route.js
│       ├── public/
│       │   ├── leads/route.js                  ← sin auth (formularios públicos)
│       │   └── referidos/route.js
│       ├── referidos/route.js  +  [id]/route.js
│       ├── register/route.js
│       ├── training/
│       │   ├── companies/route.js  +  [id]/route.js
│       │   ├── companies/[id]/courses/route.js  +  [courseId]/route.js
│       │   ├── courses/route.js  +  [id]/route.js
│       │   ├── enrollments/route.js  +  export/route.js
│       │   ├── quiz-attempts/route.js  +  [id]/route.js
│       │   └── users/route.js  +  import/  +  export/
│       ├── usuarios/register/empresa/route.js
│       └── webhooks/tutorlms/
│           ├── course/route.js
│           ├── enrollment/route.js
│           ├── quiz-attempt/route.js
│           ├── sync/route.js
│           └── sync-courses/route.js
│
├── components/
│   ├── layout/
│   │   ├── DashboardShell.jsx
│   │   └── Sidebar.jsx
│   └── training/
│       ├── TrainingBadge.jsx
│       └── TrainingTable.jsx
│
├── lib/
│   ├── auth/
│   │   └── jwt.js                              ← verificación y generación JWT
│   ├── billing/
│   │   ├── calculateInvoice.js
│   │   ├── generateInvoiceNumber.js
│   │   ├── getApplicableRate.js
│   │   └── updateInvoiceStatus.js
│   ├── db/
│   │   ├── masterDb.js                         ← singleton schema master
│   │   ├── sequalize.js                        ← factoría Sequelize (typo en nombre)
│   │   └── tenantDb.js                         ← pool por tenant
│   ├── tenant/
│   │   ├── tenantCache.js                      ← caché en memoria TTL 60s
│   │   ├── tenantResolver.js                   ← getTenantContext(request)
│   │   └── withTenant.js                       ← wrapper para rutas API
│   └── utils/
│       ├── apiKeyAuth.js
│       ├── apiResponse.js
│       └── errors.js
│
├── models/
│   ├── master/
│   │   ├── AuditLog.model.js
│   │   ├── Tenant.model.js
│   │   ├── TenantModule.model.js
│   │   └── User.model.js
│   └── tenant/
│       ├── Asset.model.js
│       ├── Client.model.js
│       ├── Company.model.js                    ← empresas (módulo formación)
│       ├── CompanyCourse.model.js              ← pivot empresa↔curso
│       ├── Contact.model.js
│       ├── Cost.model.js                       ← costes (módulo facturación)
│       ├── Course.model.js
│       ├── CourseEnrollment.model.js
│       ├── Invoice.model.js
│       ├── Lead.model.js
│       ├── Message.model.js
│       ├── Notification.model.js
│       ├── Payment.model.js                    ← cobros (módulo facturación)
│       ├── Project.model.js
│       ├── QuizAttempt.model.js                ← cuestionarios TutorLMS
│       ├── Rate.model.js                       ← tarifas (módulo facturación)
│       ├── RecurringInvoice.model.js           ← facturas recurrentes
│       ├── Task.model.js
│       ├── TeamMember.model.js
│       ├── Ticket.model.js
│       ├── Training.model.js
│       └── TrainingUser.model.js
│
├── modules/
│   ├── cuestionarios/CuestionariosModule.jsx
│   ├── leads/LeadsModule.jsx                   ← módulo base de leads
│   └── overrides/                              ← UI personalizada por tenant
│       ├── abarcaia/LeadsModule.jsx
│       ├── aumenta/LeadsModule.jsx
│       ├── demo/LeadsModule.jsx
│       ├── quality-energy/
│       │   ├── LeadsModule.jsx
│       │   └── ReferidosModule.jsx
│       └── retorika/LeadsModule.jsx
│
├── scripts/                                    ← scripts de DB (seed, sync, migraciones)
│   ├── db-seed.js
│   ├── db-sync.js
│   ├── seed-master.js
│   ├── seed-abarcaia.js
│   ├── seed-aumenta.js
│   ├── seed-cuestionarios-demo.js
│   ├── seed-quality-energy.js
│   ├── seed-retorika.js
│   ├── add-leads-module-demo.js
│   ├── add-referidos-module-quality.js
│   ├── add-training-module-demo.js
│   ├── cleanup-bad-leads.js
│   ├── clear-abarcaia-leads.js
│   ├── clear-aumenta-leads.js
│   ├── clear-quality-leads.js
│   ├── migrate-quality-leads.js
│   ├── migrate-rename-therapist-to-employee.js ← rename FK billing therapistId→employeeId
│   └── remove-abarcaia-from-quality.js
│
├── Dockerfile                                  ← imagen de producción
├── docker-compose.yml                          ← orquestación producción (app + db)
├── deploy.sh                                   ← script de deploy en VPS
├── middleware.js
├── next.config.mjs
├── package.json
├── jsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
├── .prettierrc
├── .env.local                                  ← config local (gitignored)
└── .env.production.example                     ← plantilla para producción
```

---

## Infraestructura de código — `/lib` (no tocar sin justificación)

### `lib/db/sequalize.js`

Factoría base. Recibe un schema, devuelve instancia Sequelize configurada.
No usar directamente — usar `masterDb.js` o `tenantDb.js`.

### `lib/db/masterDb.js`

Singleton schema `master`. Exports: `getMasterDb()`, `getMasterModels()` → { Tenant, User, TenantModule, AuditLog }

### `lib/db/tenantDb.js`

Pool de conexiones por tenant (una instancia por schema, cacheada en Map).
Purge automático idle cada 5 min.
Exports: `getTenantDb(slug)`, `closeAllConnections()`, `getPoolStats()`

### `lib/tenant/tenantResolver.js`

Resuelve tenant desde subdominio, header `x-tenant` o JWT. Cachea 60s.
Exports: `getTenantContext(request)`, `invalidateTenantCache(slug)`

Devuelve: `tenant`, `tenantModels`, `hasModule(key)`, `getLogicOverride(key, subkey)`, `hasFeatureFlag(key, flag)`

### `lib/tenant/withTenant.js`

Wrapper para rutas API que inyecta el contexto del tenant automáticamente.

### `lib/auth/jwt.js`

Generación y verificación de tokens JWT.

### `lib/billing/`

Utilidades del módulo de facturación: cálculo de facturas, numeración, tarifas aplicables, actualización de estado.

---

## Modelos

### Schema `master` (`models/master/`)

- `Tenant` — id (UUID), name, slug, dbName, plan, status, settings (JSONB)
- `User` — id (UUID), email, passwordHash, role, tenantId, moduleAccess, lastLoginAt
- `TenantModule` — id, tenantId, moduleKey, enabled, version, schemaExtensions, logicOverrides, uiOverride, featureFlags
- `AuditLog` — id, tenantId, userId, action, entity, entityId, before, after, ip

### Schema tenant (`models/tenant/`)

- `Client` — clientes individuales y empresas, incluye acceso portal
- `Contact` — contactos por rol asociados a cliente
- `Lead` — oportunidades con stages y probability
- `Project` — proyectos con columnas Kanban
- `Task` — tarjetas Kanban (columnId, order, checklist)
- `Ticket` — incidencias con mensajes tipo chat
- `Invoice` — facturas con líneas, IVA, PDF, facturantiaId, qrUrl, verifactuStatus, `employeeId` (FK a TeamMember)
- `RecurringInvoice` — facturas recurrentes programadas
- `Payment` — cobros asociados a facturas
- `Cost` — costes y gastos, `employeeId` (FK a TeamMember)
- `Rate` — tarifas configurables, `employeeId` (FK a TeamMember)
- `TeamMember` — perfil extendido del user en el tenant; tabla compartida que representa "personas que trabajan en el tenant" (empleados, externos, subcontratados). Usada también como FK desde Rate/Invoice/Cost.
- `Asset` — inventario (equipos, licencias, materiales)
- `Training` — formación y certificados por usuario
- `Company` — empresas cliente del módulo formación (no confundir con `Client`)
- `Course` — cursos con `wpCourseId` (TutorLMS) y `wcProductId` (WooCommerce)
- `CompanyCourse` — pivot empresa↔curso
- `TrainingUser` — alumnos (tipo `private` o `company`)
- `CourseEnrollment` — matrículas con `enrolledAt` y metadata JSONB
- `QuizAttempt` — intentos de cuestionarios TutorLMS
- `Notification` — notificaciones por canal
- `Message` — chat interno por canal

---

## Tenants activos

> **Convención de slug**: el slug en `master.tenants.slug` y los nombres
> de schema PostgreSQL usan **underscore** (`quality_energy`,
> `spain_enzymes`). El regex de validación en `lib/db/tenantDb.js`
> solo acepta `[a-z0-9_]`. Las carpetas de overrides en
> `modules/overrides/` usan **guión** por convención cosmética
> (`quality-energy/`, `spain-enzymes/`). Para evitar confusiones,
> en esta tabla y en el resto de documentación nueva se listan los
> slugs **tal cual están en BD** (con underscore).

| Slug             | Entorno         | Módulos activos                                         | Notas                                        |
| ---------------- | --------------- | ------------------------------------------------------- | -------------------------------------------- |
| `demo`           | local + prod    | clients, leads, calendar, inventory, billing, team, training | Tenant de desarrollo y pruebas; show-room    |
| `retorika`       | solo producción | training, clients                                       | Academia online (WordPress + TutorLMS)       |
| `quality_energy` | local + prod    | leads                                                   | Empresa energética. Tuvo `referidos` en su día (limpiado por `remove-abarcaia-from-quality.js`) |
| `aumenta`        | local + prod    | leads                                                   | Centro de psicología y formación             |
| `abarcaia`       | solo producción | leads, referidos                                        | Programa de referidos vía formulario público |
| `spain_enzymes`  | solo local      | leads, clients, inventory, billing                      | Tenant de pruebas creado por Jorge           |

Datos verificados contra `master.tenants` y `master.tenant_modules` el
2026-04-30 (entorno local). Los tenants `retorika` y `abarcaia` solo
existen en producción; sus módulos provienen de los seeds
correspondientes.

Cada tenant puede tener override de UI en `modules/overrides/{slug}/`
(carpeta con guión) y seed propio en `scripts/seed-{slug}.js` cuando
aplique.

---

## Módulos del CRM — 17 planificados

| moduleKey      | Módulo                        | Estado                                          |
| -------------- | ----------------------------- | ----------------------------------------------- |
| clients        | #1 Clientes & Cuentas         | Implementado parcial (spain-enzymes)            |
| sales          | #2 Comercial & Ventas (Leads) | Implementado (5 tenants)                        |
| projects       | #3 Proyectos (Kanban)         | Pendiente                                       |
| support        | #4 Soporte & Calidad          | Pendiente                                       |
| billing        | #5 Facturación                | Implementado parcial (demo, aumenta)            |
| team           | #6 Equipo & RRHH              | Pendiente                                       |
| planning       | #7 Planificación & Recursos   | Pendiente                                       |
| documents      | #8 Documentación & Contratos  | Pendiente                                       |
| —              | #9 Filtro global por cliente  | Pendiente                                       |
| inventory      | #10 Inventario & Activos      | Implementado parcial (spain-enzymes)            |
| training       | #11 Formación & Conocimiento  | Implementado (Retorika)                         |
| automations    | #12 Automatizaciones & Flujos | Pendiente                                       |
| ai             | #13 IA & Asistente            | Pendiente                                       |
| integrations   | #14 Integraciones & API       | Pendiente                                       |
| analytics      | #15 Analítica & BI            | Pendiente                                       |
| communications | #16 Comunicaciones            | Pendiente                                       |
| client_portal  | #17 Portal del Cliente        | Pendiente                                       |

---

## Decisiones técnicas cerradas

### Facturación — Verifactu

- API de Facturantia (10€/mes, incluye Verifactu)
- CRM crea factura → Facturantia API → qrUrl + número → PDF con QR
- Campos extra en Invoice: `facturantiaId`, `qrUrl`, `verifactuStatus`, `verifactuSentAt`

### Facturación — nomenclatura

- Las FK que apuntan a `TeamMember` desde Rate/Invoice/Cost se llaman `employeeId`
  (anteriormente `therapistId`, renombrado en abril 2026 porque el CRM es genérico).
- En la API, el alias del include es `employee` y el endpoint analítico es
  `/api/billing/analytics/employees`.

### Automatizaciones

- n8n como motor externo. CRM dispara webhooks → n8n ejecuta lógica.

### IA

- API OpenAI. Patrón: datos tenant → JSON → prompt → parsear respuesta → pintar.

### Módulo de Formación — Retorika

Implementado para `retorika` (WordPress + TutorLMS + WooCommerce). Reutilizable.

**Endpoints WordPress** (SIN JWT, URL invariable):
- `GET /api/cursos-empresas/codigos-cursos/:email` — array de `wpCourseId`
- `POST /api/webhooks/tutorlms/quiz-attempt` — HMAC SHA256 con `X-Retorika-Signature`

---

## Reglas de trabajo

1. Verificar si un fichero ya existe antes de crearlo
2. No modificar ficheros de `/lib/` sin explicar el motivo
3. Schemas base de tenant → `models/tenant/`
4. Overrides de UI por cliente → `modules/overrides/{slug}/`
5. Cambios que afecten a la arquitectura multi-tenant → consultar antes
6. Cada módulo nuevo: modelo → endpoints → frontend
7. Siempre usar `getTenantContext` en las rutas — nunca conectar directo a PostgreSQL
8. Terminal: PowerShell (Windows), no bash
9. No usar TypeScript — JavaScript puro
10. No usar `src/` — `app/` en la raíz del proyecto
11. **NUNCA ejecutar `git add` ni `git commit`** — Jorge hace los commits manualmente.
    Cuando haya cambios listos, ofrecer un mensaje de commit sugerido para que Jorge lo copie y ejecute él mismo.
12. Scripts de migración deben leer la lista de schemas desde `master.tenants`,
    nunca hardcodear slugs (la lista difiere entre local y producción).
13. En diseño responsivo, todo modal o panel lateral (drawer) debe respetar la
    barra superior móvil del dashboard (`h-14`, ~56px, `lg:hidden`) que contiene
    el botón del menú hamburguesa. Patrón: `top-14 lg:top-0 ... bottom-0`
    (en lugar de `top-0 h-full`). Aplica al módulo Equipo, Leads y cualquier
    otro nuevo o existente que abra paneles encima de la página.

---

## Skills disponibles

Usar automáticamente cuando corresponda:

- **frontend-design** — componentes React, páginas, layouts, UI
  - Mobile-first con Tailwind (diseñar móvil → escalar con sm:, md:, lg:)
  - CRM en desktop es prioritario; portal cliente (#17) debe funcionar en móvil
- **xlsx** — exportaciones de datos, informes en Excel
- **docx** — generación de documentos Word
- **pdf** — generación de facturas o documentos PDF
- **file-reading** — cuando se suba un fichero para analizar

---

## Seguridad — reglas obligatorias

### Autenticación y autorización

- Validar JWT antes de resolver tenant — nunca fiar slug de URL sin verificar
- JWT en httpOnly cookies — nunca localStorage
- Refresh token con rotación
- Rate limiting en endpoints de auth

### Aislamiento entre tenants

- Nunca queries sin `getTenantContext` — directo a PostgreSQL prohibido
- Verificar que el recurso pertenece al tenant activo
- Schemas de PostgreSQL son la primera barrera
- Validar acceso al módulo con `hasModule()` en cada endpoint

### Datos sensibles

- Passwords: bcrypt mínimo 12 rounds — nunca texto plano
- Nunca devolver `passwordHash` en API
- Credenciales en `.env.local` / `.env.production` — nunca hardcodeadas
- `.env*` en `.gitignore`

### Inputs y queries

- Sanitizar y validar todos los inputs antes de Sequelize
- Siempre métodos de Sequelize (nunca SQL raw con inputs del usuario)
- Si SQL raw necesario → `sequelize.escape()` obligatorio

### API y respuestas

- Portal cliente (`/app/portal/`) aislado del dashboard interno
- Sin stack traces en producción — errores genéricos al cliente, detalle en logs
- CORS explícito — nunca `origin: *` en producción
- HTTPS obligatorio en producción

### Auditoría

- Registrar en `AuditLog` cambios de configuración de tenant y accesos fallidos
- Logs de auditoría nunca se borran ni modifican
