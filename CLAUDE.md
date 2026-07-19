# CRM SaaS Salamandra Solutions

## Quién soy

Soy Jorge, informático de Salamandra Solutions. Construyo un CRM SaaS
multi-tenant para vender como producto a empresas. Actúas como mi
arquitecto y senior developer de referencia.

---

## Documentación detallada del proyecto

Antes de implementar cambios en un módulo concreto, lee su doc:

| Módulo            | Doc                          | Estado                           |
| ----------------- | ---------------------------- | -------------------------------- |
| Clientes          | `docs/modules/clients.md`    | Implementado                     |
| Leads / Comercial | `docs/modules/leads.md`      | Implementado                     |
| Proyectos         | `docs/modules/projects.md`   | Implementado (demo, aumenta)     |
| Facturación       | `docs/modules/billing.md`    | Implementado                     |
| Equipo & RRHH     | `docs/modules/team.md`       | Implementado                     |
| Inventario        | `docs/modules/inventory.md`  | Implementado                     |
| Formación         | `docs/modules/training.md`   | Implementado                     |
| Citas             | `docs/modules/citas.md`      | Implementado                     |
| Pacientes         | `docs/modules/pacientes.md`  | Implementado (aumenta)           |
| Clínica           | `docs/modules/clinica.md`    | Implementado (aumenta)           |
| Nutrición         | `docs/modules/nutricion.md`  | C1+C2+C3 en prod, C4+C5 en local |
| Outreach          | `docs/modules/outreach.md`   | Completo en local, sin desplegar  |
| Configuración     | `docs/modules/configuracion.md` | Implementado (claves IA por tenant) |
| Emails (infra)    | `docs/modules/emails.md`     | Infra transversal                |

Módulos implementados **sin doc dedicado** (su detalle vive en la tabla de
módulos más abajo): `calendar`, `orders`, `referidos`, `cuestionarios`.

Cualquier detalle no recogido en CLAUDE.md (endpoints específicos,
fórmulas de cálculo, decisiones de implementación, validaciones,
integraciones cross-module) vive en estos docs. Si encuentras una
discrepancia entre código y doc, prevalece el código: actualiza el doc.

Decisiones arquitectónicas históricas: `docs/decisions/` (cuando exista).

---

## Stack técnico

| Capa             | Tecnología                               |
| ---------------- | ---------------------------------------- |
| Frontend+Backend | Next.js 16 (App Router + Route Handlers) |
| Base de datos    | PostgreSQL                               |
| ORM              | Sequelize                                |
| Multi-tenant     | Schema por tenant (`crm_{slug}`)         |
| Estilos          | Tailwind CSS 4                           |
| Despliegue       | VPS propio (Docker)                      |
| Automatizaciones | n8n (instancia propia)                   |
| IA               | Claude (Anthropic) + Whisper (OpenAI) — clave por tenant |
| Lenguaje         | JavaScript puro (SIN TypeScript)         |

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

| Container              | Imagen               | Puerto                 | Descripción                  |
| ---------------------- | -------------------- | ---------------------- | ---------------------------- |
| `crm-salamandra-app-1` | `crm-salamandra-app` | `127.0.0.1:3000->3000` | App Next.js (producción)     |
| `crm-salamandra-db-1`  | `postgres:16-alpine` | 5432 (interno Docker)  | PostgreSQL del CRM           |
| `n8n`                  | `n8nio/n8n:latest`   | `127.0.0.1:5678->5678` | Motor de automatizaciones    |
| `n8n-postgres`         | `postgres:15-alpine` | 5432 (interno Docker)  | PostgreSQL de n8n (separada) |

**Los schemas (estructura de tablas) son los mismos porque vienen del código.
Los datos de cada entorno son completamente independientes — no hay sincronización de datos entre local y producción.**

> **Nota sobre tenants:** la lista de tenants en local y en producción NO es necesariamente la misma.
> Algunos tenants viven solo en producción (`retorika`, `abarcaia`) y otros solo en local
> (`spain_enzymes` por ahora). Cualquier script de migración debe leer la lista de schemas a
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
├── schema: crm_quality_energy  ← Quality Energy (leads)
├── schema: crm_aumenta         ← Aumenta (leads)
├── schema: crm_abarcaia        ← Abarcaia (leads + referidos) — solo producción
└── schema: crm_spain_enzymes   ← Spain Enzymes (leads, clientes, inventario, billing) — solo local por ahora
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

## Estructura de carpetas

```
crm-salamandra-2/
├── app/                  ← rutas Next.js: /api (route handlers), (auth), (dashboard)
├── components/           ← componentes React compartidos
├── lib/                  ← infraestructura: db, auth, tenant, billing, team, leads, training, utils
├── models/               ← modelos Sequelize: master/ (global) y tenant/ (por schema)
├── modules/              ← módulos UI con overrides por tenant (modules/overrides/{slug}/)
├── scripts/              ← scripts de DB: seeds, migraciones, mantenimiento
├── docs/                 ← documentación detallada por módulo y decisiones
├── Dockerfile, docker-compose.yml, deploy.sh
├── middleware.js, next.config.mjs, package.json, eslint.config.mjs, .prettierrc
└── .env.local (gitignored), .env.production.example
```

El detalle de cada subcarpeta se descubre con `ls` cuando haga falta.

---

## Infraestructura de código — `/lib`

| Carpeta         | Propósito                                                                                                               | Notas                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `lib/db/`       | Conexiones Sequelize: `masterDb` (singleton), `tenantDb` (pool por tenant), `sequalize` (factoría base, typo en nombre) | Pool con purge idle automático cada 5 min                                     |
| `lib/tenant/`   | Resolver multi-tenant: `getTenantContext`, `invalidateTenantCache`, `withTenant`                                        | Cachea config 60s. Devuelve `hasModule`, `getLogicOverride`, `hasFeatureFlag` |
| `lib/auth/`     | JWT: generación y verificación                                                                                          | —                                                                             |
| `lib/billing/`  | Lógica de facturación (cálculo, numeración, tarifas, estado)                                                            | Detalle en `docs/modules/billing.md`                                          |
| `lib/team/`     | Serializer de `TeamMember`                                                                                              | Detalle en `docs/modules/team.md`                                             |
| `lib/leads/`    | Stages canónicos de leads                                                                                               | Detalle en `docs/modules/leads.md`                                            |
| `lib/training/` | Helper de auth HMAC para webhooks de TutorLMS                                                                           | Detalle en `docs/modules/training.md`                                         |
| `lib/utils/`    | Utilidades comunes: `apiResponse`, `errors`, `apiKeyAuth`                                                               | —                                                                             |

**Regla**: no modificar nada de `/lib/` sin explicar el motivo (regla #2).

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
- `Lead` — oportunidades comerciales (detalle en `docs/modules/leads.md`)
- `Project` — proyectos con columnas Kanban
- `Task` — tarjetas Kanban (columnId, order, checklist)
- `Ticket` — incidencias con mensajes tipo chat
- `Invoice` — facturas, incl. campos Verifactu y `employeeId` (detalle en `docs/modules/billing.md`)
- `RecurringInvoice` — facturas recurrentes programadas (detalle en `docs/modules/billing.md`)
- `Payment` — cobros asociados a facturas (detalle en `docs/modules/billing.md`)
- `Cost` — costes y gastos, `employeeId` (detalle en `docs/modules/billing.md`)
- `Rate` — tarifas configurables, `employeeId` (detalle en `docs/modules/billing.md`)
- `TeamMember` — perfil extendido del usuario en el tenant; FK desde Rate/Invoice/Cost (detalle en `docs/modules/team.md`)
- `Asset` — equipos/licencias/materiales internos (NO el inventario comercial)
- `InboundProduct`, `InboundBatch`, `OutboundProduct`, `Formula`, `ClientOutboundAlias`, `StockMovement` — módulo Inventario (detalle en `docs/modules/inventory.md`). Reemplazan al viejo `InventoryProduct`: el modelo Sequelize y los endpoints legacy ya no existen; la tabla `inventory_products` se conserva en BD como respaldo hasta que se decida la migración definitiva.
- `Course`, `CompanyCourse`, `TrainingUser`, `CourseEnrollment`, `QuizAttempt`, `Company`, `Training` — módulo Formación (detalle en `docs/modules/training.md`)
- `OutreachLead`, `OutreachContact`, `OutreachAnalysis`, `OutreachBusinessLine`, `OutreachSettings` — módulo Captación (detalle en `docs/modules/outreach.md`). **No confundir `OutreachLead` con `Lead`**: el primero es una empresa captada y sin contactar, el segundo una oportunidad comercial. Son independientes, sin FK entre ellos; por eso las tablas van prefijadas `outreach_`.
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

| Slug             | Entorno         | Módulos activos                                              | Notas                                                                                           |
| ---------------- | --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `demo`           | local + prod    | clients, leads, calendar, inventory, billing, team, training | Tenant de desarrollo y pruebas; show-room                                                       |
| `retorika`       | solo producción | training, clients                                            | Academia online (WordPress + TutorLMS)                                                          |
| `quality_energy` | local + prod    | leads                                                        | Empresa energética. Tuvo `referidos` en su día (limpiado por `remove-abarcaia-from-quality.js`) |
| `aumenta`        | local + prod    | leads\*, training\*, clients, calendar, citas, clinica, pacientes, projects, billing, inventory, orders, team (12) | Centro de psicología y formación. 12 módulos en prod (verif. 2026-07-07). \* = override UI: `aumenta/LeadsModule` y `aumenta/FormacionOverview` (este último con `logicOverrides` declarativos que hoy no lee ningún código). Label sidebar "Leads" → "Interesados". |
| `abarcaia`       | solo producción | leads, referidos                                             | Programa de referidos vía formulario público                                                    |
| `spain_enzymes`  | solo local      | leads, clients, inventory, billing, orders                   | Tenant de pruebas creado por Jorge. Módulo orders (Pedidos) específico de Spain Enzymes         |
| `nutri_laura`    | local + prod    | citas, leads, clients, training, nutricion                   | Nutricionista (Laura). Override leads (embudo nutricional) + conversión lead→paciente + override overview formación (B2C, sin TutorLMS aún). Subido a prod 2026-06-23 con sprint Recetario C1. |

Datos verificados contra `master.tenants` y `master.tenant_modules` el
2026-04-30 (entorno local), salvo `aumenta`, re-verificado en
**producción** el 2026-07-07 (12 módulos activos). Los tenants `retorika`
y `abarcaia` solo existen en producción; sus módulos provienen de los
seeds correspondientes. El resto de filas puede haber divergido respecto
a producción — re-verificar con `scripts/inspect-tenant-modules.js <slug>`
(solo lectura) antes de fiarse.

Cada tenant puede tener override de UI en `modules/overrides/{slug}/`
(carpeta con guión) y seed propio en `scripts/seed-{slug}.js` cuando
aplique.

---

## Módulos del CRM — 17 planificados

> **Leyenda de estado**: _Implementado_ = con endpoints + UI en
> producción. _Pendiente_ = solo entrada **placeholder** en `Sidebar.jsx`
> (aparece en el menú si el tenant activa el `moduleKey`, pero la página
> aún no existe; hoy ningún tenant los activa). La fuente autoritativa de
> qué módulos existen como concepto es `components/layout/Sidebar.jsx`.

### Del plan 1-16

| moduleKey       | Módulo                        | Estado                                       | Doc detallado               |
| --------------- | ----------------------------- | -------------------------------------------- | --------------------------- |
| clients         | #1 Clientes & Cuentas         | Implementado                                 | `docs/modules/clients.md`   |
| sales / leads   | #2 Comercial & Ventas (Leads) | Implementado (varios tenants)                | `docs/modules/leads.md`     |
| projects        | #3 Proyectos (Kanban)         | Implementado (demo, aumenta)                 | `docs/modules/projects.md`  |
| support         | #4 Soporte & Calidad          | Pendiente (solo modelo `Ticket`, sin API/UI) | —                           |
| billing         | #5 Facturación                | Implementado (demo, aumenta, spain_enzymes)  | `docs/modules/billing.md`   |
| team            | #6 Equipo & RRHH              | Implementado                                 | `docs/modules/team.md`      |
| planning        | #7 Planificación & Recursos   | Pendiente                                    | —                           |
| documents       | #8 Documentación & Contratos  | Sprint 1+2 (backend+UI) en local, sin desplegar | `docs/modules/documents.md` |
| —               | #9 Filtro global por cliente  | Pendiente (feature transversal, sin menú)    | —                           |
| inventory       | #10 Inventario & Activos      | Implementado (spain_enzymes, demo, aumenta)  | `docs/modules/inventory.md` |
| training        | #11 Formación & Conocimiento  | Implementado (retorika, aumenta)             | `docs/modules/training.md`  |
| automations     | #12 Automatizaciones & Flujos | Pendiente (motor n8n externo, sin módulo UI) | —                           |
| ai              | #13 IA & Asistente            | Pendiente                                    | —                           |
| integrations    | #14 Integraciones & API       | Pendiente (infra parcial: webhooks/external) | —                           |
| analytics       | #15 Analítica & BI            | Pendiente                                    | —                           |
| communications  | #16 Comunicaciones            | Pendiente (modelos `Message`/`Notification`) | —                           |

### Fuera del plan 1-16 (ya implementados)

| moduleKey     | Módulo                         | Estado                              | Doc detallado               |
| ------------- | ------------------------------ | ----------------------------------- | --------------------------- |
| calendar      | Calendario                     | Implementado (demo, aumenta)        | —                           |
| citas         | Citas (reservas + portal SSO)  | Implementado (nutri_laura, aumenta) | `docs/modules/citas.md`     |
| orders        | Pedidos                        | Implementado (spain_enzymes, aumenta) | —                         |
| referidos     | Referidos (formulario público) | Implementado (abarcaia)             | —                           |
| cuestionarios | Cuestionarios (TutorLMS)       | Implementado (retorika)             | (dentro de `training.md`)   |
| pacientes     | Pacientes                      | Implementado (aumenta)              | `docs/modules/pacientes.md` |
| clinica       | Clínica                        | Implementado (aumenta)              | `docs/modules/clinica.md`   |
| nutricion     | Recetario                      | C1+C2+C3 en prod, C4+C5 en local    | `docs/modules/nutricion.md` |
| outreach      | Captación (leads + scoring IA) | Completo en local (sandbox); falta desplegar | `docs/modules/outreach.md` |
| —             | Configuración (ajustes + claves IA por tenant) | Implementado (siempre visible, sin `moduleKey`) | `docs/modules/configuracion.md` |

> **`leads` vs `sales`**: hay dos `moduleKey` para el área comercial
> (`leads` → `/leads`, `sales` → `/comercial`). En producción los tenants
> activan `leads`. Inconsistencia de nomenclatura heredada, pendiente de
> unificar.
>
> **`pacientes` / `clinica`**: backend **REAL** (CRUD + IA), ya **no** son maqueta.
> Tienen endpoints propios en `app/api/pacientes/*` y `app/api/clinica/*`
> (`sessions`, `sessions/transcribe`, `reports`, `coordinations`, `overview`,
> `performance`). Modelos `Patient`, `ClinicSession`, `ClinicalReport`,
> `Coordination`, `PerformanceMetric`; serializers en `lib/clinica/`. Flujo de audio
> (Fase 3): Whisper (OpenAI) transcribe + Claude estructura. Activos en `aumenta` y en
> `demo` (escaparate, con datos de `scripts/seed-clinica-demo.js`). Detalle en
> `docs/modules/{clinica,pacientes}.md`.
>
> **Placeholders sin construir** (entradas en `Sidebar.jsx` que hoy nadie
> activa): `support`, `planning`, `documents`, `analytics`, `ai`,
> `automations`, `integrations`.

---

## Decisiones técnicas cerradas

### Facturación — Verifactu

- API de Facturantia (10€/mes, incluye Verifactu).
- CRM crea factura → Facturantia API → qrUrl + número → PDF con QR.
- Campos extra en Invoice: `facturantiaId`, `qrUrl`, `verifactuStatus`, `verifactuSentAt`.
- Detalle del flujo, errores y endpoints en `docs/modules/billing.md`.

### Facturación — nomenclatura `employeeId`

- Las FK que apuntan a `TeamMember` desde Rate/Invoice/Cost se llaman `employeeId`
  (anteriormente `therapistId`, renombrado en abril 2026 porque el CRM es genérico).
- En la API, el alias del include es `employee` y el endpoint analítico es
  `/api/billing/analytics/employees`.
- Migración del rename: `scripts/migrate-rename-therapist-to-employee.js`.

### Automatizaciones

- n8n como motor externo. CRM dispara webhooks → n8n ejecuta lógica.

### IA

- **Claude (Anthropic)** — análisis de leads (Outreach, `lib/outreach/analysis/`) y
  resumen/estructura de sesiones clínicas (`lib/clinica/structureSession.js`).
  Dependencia `@anthropic-ai/sdk`. **Clave POR TENANT** (Configuración → IA →
  `settings.integrations.anthropicApiKey`), resuelta por `lib/ai/anthropicKey.js`.
  **NO se usa `ANTHROPIC_API_KEY` del entorno** (BYOK): sin clave → 503.
- **Modelo de Claude configurable por tenant** (`settings.integrations.anthropicModel`,
  resuelto por `lib/ai/anthropicModel.js`). **Sonnet por defecto** (Opus consume muchos
  más tokens); hay selector en Configuración → IA. El modelo se aplica a TODO el CRM.
- **Whisper (OpenAI)** — SOLO para transcribir el audio de las sesiones clínicas
  (voz → texto; `lib/clinica/whisper.js`, REST directa sin SDK). Clave POR TENANT
  (`settings.integrations.openaiApiKey`, resuelta por `lib/ai/openaiKey.js`). Luego
  Claude estructura el texto. **La `OPENAI_API_KEY` del entorno NO se usa** (BYOK).
- Patrón: datos tenant → prompt desde config del tenant → pedir solo JSON → parsear
  con try/catch y normalizar → persistir. Nada de IA se dispara solo: cuesta dinero.

---

## Reglas de trabajo

1. Verificar si un fichero ya existe antes de crearlo.
2. No modificar ficheros de `/lib/` sin explicar el motivo.
3. Schemas base de tenant → `models/tenant/`.
4. Overrides de UI por cliente → `modules/overrides/{slug}/`.
5. Cambios que afecten a la arquitectura multi-tenant → consultar antes.
6. Cada módulo nuevo: modelo → endpoints → frontend.
7. Siempre usar `getTenantContext` en las rutas — nunca conectar directo a PostgreSQL.
8. Terminal: PowerShell (Windows), no bash.
9. No usar TypeScript — JavaScript puro.
10. No usar `src/` — `app/` en la raíz del proyecto.
11. **Commits: los puede hacer Claude, pero SOLO cuando se lo piden explícitamente.**
    Desde 2026-07-19 el flujo es **commits directos a `master`, sin PRs ni ruleset**
    (decisión de Jorge; el socio también sube y despliega). Reglas:
    - **No commitear de forma proactiva.** Dejar los cambios sin commitear hasta que
      Jorge (o el socio) lo pida ("commitea esto").
    - Cuando lo pidan: `git add` revisando que NO entren `.env*` ni secretos,
      `git commit` en `master` con Conventional Commits + trailer `Co-Authored-By`,
      **`npm run build` en verde ANTES del push** (ya no hay CI que lo pare) y
      `git push origin master`. Enseñar siempre qué se commiteó.
    - Para trabajos grandes sigue estando bien una rama local temporal, pero se
      fusiona a `master` en local y el push va a `master` (sin PR).
    - **Prohibido reescribir historia en master**: nada de `push --force` ni
      `reset --hard` sobre commits ya subidos; los errores se arreglan con un
      commit nuevo o `git revert`.
    - **Sincronización local (housekeeping) SÍ la puede hacer Claude** cuando se lo
      pidan: `git fetch`, `git switch master`, `git pull` y `git branch -d` de ramas
      ya fusionadas. Nada destructivo sin permiso explícito.
12. Scripts de migración deben leer la lista de schemas desde `master.tenants`,
    nunca hardcodear slugs (la lista difiere entre local y producción).
13. En diseño responsivo, todo modal o panel lateral (drawer) debe respetar la
    barra superior móvil del dashboard (`h-14`, ~56px, `lg:hidden`) que contiene
    el botón del menú hamburguesa. Patrón: `top-14 lg:top-0 ... bottom-0`
    (en lugar de `top-0 h-full`). Aplica al módulo Equipo, Leads y cualquier
    otro nuevo o existente que abra paneles encima de la página.
14. **Secrets de producción NUNCA pasan por chats con LLMs ni por canales no seguros**.
    Cuando se rote un secret (HMAC, API key, password), generarlo localmente,
    configurarlo directamente en `.env.production` del VPS por SSH, y comunicarlo
    a terceros (clientes, integraciones) por canal cifrado. Si un secret se ha
    visto en un chat, considerarlo comprometido y rotarlo inmediatamente.

**PowerShell vs bash en ejemplos**: el entorno local de Jorge es PowerShell
(Windows). Cuando se necesite curl, usar `curl.exe` para invocar el binario
nativo de Windows (el alias `curl` de PowerShell apunta a `Invoke-WebRequest`
con sintaxis distinta). En el VPS de producción es bash y `curl` funciona
como en Linux.

---

## Skills disponibles

Usar automáticamente cuando corresponda:

- **frontend-design** — componentes React, páginas, layouts, UI
  - Mobile-first con Tailwind (diseñar móvil → escalar con sm:, md:, lg:)
  - CRM en desktop es prioritario;
- **xlsx** — exportaciones de datos, informes en Excel
- **docx** — generación de documentos Word
- **pdf** — generación de facturas o documentos PDF
- **file-reading** — cuando se suba un fichero para analizar

---

## Seguridad — reglas obligatorias

### Autenticación y autorización

- Validar JWT antes de resolver tenant — nunca fiar slug de URL sin verificar.
- JWT en httpOnly cookies — nunca localStorage.
- Refresh token con rotación.
- Rate limiting en endpoints de auth.

### Aislamiento entre tenants

- Nunca queries sin `getTenantContext` — directo a PostgreSQL prohibido.
- Verificar que el recurso pertenece al tenant activo.
- Schemas de PostgreSQL son la primera barrera.
- Validar acceso al módulo con `hasModule()` en cada endpoint.

### Datos sensibles

- Passwords: bcrypt mínimo 12 rounds — nunca texto plano.
- Nunca devolver `passwordHash` en API.
- Credenciales en `.env.local` / `.env.production` — nunca hardcodeadas.
- `.env*` en `.gitignore`.

### Inputs y queries

- Sanitizar y validar todos los inputs antes de Sequelize.
- Siempre métodos de Sequelize (nunca SQL raw con inputs del usuario).
- Si SQL raw necesario → `sequelize.escape()` obligatorio.

### API y respuestas

- Portal cliente (`/app/portal/`) aislado del dashboard interno.
- Sin stack traces en producción — errores genéricos al cliente, detalle en logs.
- CORS explícito — nunca `origin: *` en producción.
- HTTPS obligatorio en producción.

### Auditoría

- Registrar en `AuditLog` cambios de configuración de tenant y accesos fallidos.
- Logs de auditoría nunca se borran ni modifican.
