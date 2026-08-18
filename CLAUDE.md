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
| Nutrición         | `docs/modules/nutricion.md`  | Implementado (nutri_laura, demo, aumenta, somos) |
| Formularios       | `docs/modules/formularios.md` | Implementado (nutri_laura)      |
| Outreach          | `docs/modules/outreach.md`   | Implementado (aumenta, demo, demo_agencia, salamandra_solutions, somos) |
| Soporte           | `docs/modules/support.md`    | Implementado (aumenta, demo, demo_agencia, somos) — el correo ENTRANTE aún sin dar de alta en Resend |
| Analíticas        | `docs/modules/analytics.md`  | Implementado (spain_enzymes, aumenta, somos) |
| Fichaje           | `docs/modules/fichaje.md`    | Implementado (aumenta) — control horario |
| Configuración     | `docs/modules/configuracion.md` | Implementado (claves IA por tenant) |
| Emails (infra)    | `docs/modules/emails.md`     | Infra transversal                |
| Buzón / Ayuda     | `docs/modules/buzon.md`      | Implementado (todos, sin `moduleKey`) |

Módulos implementados **sin doc dedicado** (su detalle vive en la tabla de
módulos más abajo): `calendar`, `orders`.

> **`cuestionarios` dejó de ser un módulo el 10/08/2026.** Nunca lo fue del
> todo: la puerta de sus siete endpoints era `training || cuestionarios`, así
> que quien compraba Formación ya lo tenía. Ahora es una pantalla de Formación
> (`/formacion/cuestionarios`) y solo se pide `training`. Ni el código ni la
> tabla `quiz_attempts` se han tocado — Retorika tiene ahí 526 intentos reales.

Cualquier detalle no recogido en CLAUDE.md (endpoints específicos,
fórmulas de cálculo, decisiones de implementación, validaciones,
integraciones cross-module) vive en estos docs. Si encuentras una
discrepancia entre código y doc, prevalece el código: actualiza el doc.

Decisiones arquitectónicas históricas: `docs/decisions/` (cuando exista).

> **¿Hay que apuntar una tarea en el backlog?** Léete antes
> `docs/como-apuntar-en-el-tablero.md`. `docs/backlog.md` y `docs/resuelto.md`
> son lo que pinta el tablero de `/admin/tablero`, y se trocean a mano: un
> encabezado mal puesto no da error, parte la tarea en dos o la deja sin
> cliente. Y editarlos **no basta** — viajan dentro de la imagen de Docker, así
> que hasta que no se despliega, el tablero sigue enseñando lo de antes.

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
> Algunos tenants viven solo en producción (`retorika`, `abarcaia`). Y sobre todo: **un mismo
> tenant puede tener módulos DISTINTOS en cada entorno** — `spain_enzymes` tiene cinco en local
> y solo los contratados en producción. Cualquier script de migración debe leer la lista de
> schemas a procesar desde `master.tenants` en tiempo de ejecución, nunca hardcodearla, y nadie
> debe dar por buena la lista de módulos de esta tabla sin verificarla con
> `scripts/inspect-tenant-modules.js <slug>` contra el entorno que toque.

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
├── schema: master              ← tenants, users, tenant_modules, audit_log, tablero_estado
├── schema: crm_demo            ← tenant de desarrollo (local + producción)
├── schema: crm_retorika        ← Retorika (formación)
├── schema: crm_aumenta         ← Aumenta (leads)
├── schema: crm_somos           ← Somos
└── schema: crm_spain_enzymes   ← Spain Enzymes (leads + analytics en prod; en local además clientes/inventario/billing/orders)
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
| `lib/utils/`    | Utilidades comunes: `apiResponse`, `errors`, `apiKeyAuth`, `auditoria`                                                  | —                                                                             |

> **La tabla de arriba se quedó corta** (revisado 01/08/2026): `/lib` tiene hoy
> 33 carpetas. Las que faltaban, por si ahorran un `ls`: `actividad` (frases de
> la auditoría), `ai`, `analytics`, `assistant`, `calendar`, `citas` (incluye
> `portalContract`, `portalMeses`, `avisosWhatsapp`, `recordatorios`,
> `visibilidad`), `clients` (`guardians`, `clientContract`, `signatureStorage`,
> `attachmentStorage`), `clinica` (serializers, `estadisticas`,
> `redactarInforme`, `reportPdf`, `prepFiles`, `trimestres`, `incentives`…),
> `configuracion`, `crypto` (`secretBox`), `demo` (`isDemo`), `documents`,
> `email`, `formularios`, `home`, `inventory`, `notifications`, `nutricion`,
> `outreach`, `payments`, `pdf` (fuentes de los PDF), `projects`,
> `provisioning`, `support` y `whatsapp`.

**Regla**: no modificar nada de `/lib/` sin explicar el motivo (regla #2).

---

## Modelos

### Schema `master` (`models/master/`)

- `Tenant` — id (UUID), name, slug, dbName, plan, status, settings (JSONB)
- `User` — id (UUID), email, passwordHash, role, tenantId, moduleAccess, lastLoginAt
- `TenantModule` — id, tenantId, moduleKey, enabled, version, schemaExtensions, logicOverrides, uiOverride, featureFlags
- `AuditLog` — id, tenantId, userId, action, entity, entityId, before, after, ip
- `BuzonAviso`, `BuzonMensaje`, `BuzonAdjunto` — lo que un cliente nos escribe a
  NOSOTROS desde su CRM (`/ayuda`), y nuestra respuesta. Están en `master` —y no
  en el schema de quien escribe— para que sobrevivan a su baja y para que
  funcionen aunque su base esté rota, que es cuando escriben. **Sin FK a
  `tenants` ni a `users`**: UUID sueltos más una foto de texto del cliente y de
  la persona. Es una excepción consciente a la regla de no duplicar datos
  personales en master, y va con tres frenos (aviso en el formulario, auditoría
  sin el cuerpo, y `podar-buzon.js`). Detalle en `docs/modules/buzon.md`.
- `TableroEstado` — el tick y el reparto que se ponen desde el Registro
  (`/admin/tablero`), ENCIMA de lo que dicen `docs/backlog.md` y
  `docs/resuelto.md`. El texto de las tareas sigue en esos ficheros y no se toca
  desde la pantalla: viajan dentro de la imagen y el despliegue los reescribe.
  La clave es el título normalizado; solo se guarda lo que se desvía del repo.

### Schema tenant (`models/tenant/`)

- `Client` — clientes individuales y empresas, incluye acceso portal
- `Contact` — contactos por rol asociados a cliente
- `Lead` — oportunidades comerciales (detalle en `docs/modules/leads.md`)
- `Project` — proyectos con columnas Kanban
- `Task` — tarjetas Kanban (columnId, order, checklist)
- `Ticket`, `TicketMessage`, `TicketAttachment`, `TicketCategory`, `TicketTemplate`, `SupportSettings` — módulo Soporte: helpdesk del tenant hacia SUS clientes, con nº correlativo, hilo con notas internas, SLA y portal público (detalle en `docs/modules/support.md`)
- `Invoice` — facturas, incl. campos Verifactu y `employeeId` (detalle en `docs/modules/billing.md`)
- `RecurringInvoice` — facturas recurrentes programadas (detalle en `docs/modules/billing.md`)
- `Payment` — cobros asociados a facturas (detalle en `docs/modules/billing.md`)
- `Cost` — costes y gastos, `employeeId` (detalle en `docs/modules/billing.md`)
- `Rate` — tarifas configurables, `employeeId` (detalle en `docs/modules/billing.md`)
- `TeamMember` — perfil extendido del usuario en el tenant; FK desde Rate/Invoice/Cost (detalle en `docs/modules/team.md`)
- `Asset` — equipos/licencias/materiales internos (NO el inventario comercial)
- `Product`, `StockEntry`, `StockMovement` — módulo Inventario, **rehecho el 02/08/2026** (detalle en `docs/modules/inventory.md`). Una sola tabla de productos con su `unit` (ud/kg/g/l/ml/caja/paquete), entradas de mercancía con proveedor de desplegable, y el stock como **suma de movimientos** (no hay columna de saldo). Sustituyen a `InboundProduct`, `InboundBatch`, `OutboundProduct`, `Formula` y `ClientOutboundAlias`, que **ya no existen**: modelaban comprar materia prima y fabricar, que no es lo que hace nadie. Las tablas `inventory_products` (esquema aún anterior) y la columna `costs.inventory_product_id` se conservan como respaldo.
- `Supplier` — proveedor. Entidad **compartida** entre Gastos (a quién pagas) e Inventario (quién te entrega): antes era texto libre en cada entrega y en Gastos no existía.
- `CashPoint`, `CashClose` — arqueo de caja. Era lo único de Contabilidad de Organízate que Facturación no cubría. `CashClose.difference` se guarda calculado, no se recalcula al leer: un cierre es la FOTO de lo que se contó ese día.
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

> ⚠️ **AQUÍ YA NO SE LISTAN LOS MÓDULOS DE CADA CLIENTE** (10/08/2026).
> Había una columna con ellos y **mentía en 5 de los 8 clientes**, además de
> faltarle dos enteros. Decía que Aumenta tenía 13 cuando tiene 20, y que la
> demo tenía `support` «solo en local» cuando lo tiene en producción. De esa
> tabla salieron dos tareas falsas del backlog en el mismo día.
>
> No es que nadie la actualizara: es que una lista copiada a mano de algo que
> cambia cada semana **siempre** acaba mintiendo, y aquí miente en silencio.
> La verdad está en `master.tenant_modules` y se mira en:
>
> - **`/admin/modulos`** en el back-office — quién tiene qué y qué lleva a medida.
> - **`/admin/integraciones`** — por dónde se tocan esos módulos entre sí.
> - `scripts/inspect-tenant-modules.js <slug>` (solo lectura) desde la terminal.
>
> Lo que queda abajo es lo que la base de datos NO sabe: quién es cada cliente,
> qué no se le puede tocar y por qué. Eso sí vive aquí.

> **TRES BAJAS EL 12/08/2026** (Rodrigo). `abarcaia`, `quality_energy` y
> `healim` se dieron de baja y **se purgaron sus schemas**: ya no existen ni en
> `master.tenants` ni en PostgreSQL. Antes se sacó un volcado de los tres a
> `/root/backups/bajas-abarcaia-quality-healim-20260812.sql.gz` en el VPS (84
> leads de Abarca, 129 de Quality, 5 citas pasadas de Healim). Si algún día hace
> falta algo de ahí, está en ese fichero y en ningún otro sitio.
>
> Con ellos se fueron sus overrides de leads, sus seeds y sus scripts de un solo
> uso. **Sus nombres siguen a propósito en `app/api/admin/tablero/route.js`**:
> el tablero lee tareas históricas donde están escritos, y quitarlos de esa
> lista dejaría esas tareas sin cliente.

| Slug             | Entorno         | Quién es y qué hay que saber |
| ---------------- | --------------- | ---------------------------- |
| `demo`           | local + prod    | Tenant de desarrollo y show-room. Datos FALSOS a propósito: tiene casi todos los módulos para poder enseñarlos juntos. **Es pública y da sesión de admin a cualquiera**, así que todo endpoint que mande correo, gaste IA o escriba en master necesita su guard de `lib/demo/isDemo.js`. |
| `demo_clinica`, `demo_nutricion`, `demo_agencia` | local + prod | **Las demos por oficio (13/08/2026).** La general enseñaba veinte módulos a la vez y era lo que veía todo el que pulsaba «Prueba una demo»: una nutricionista se encontraba un centro de psicología con almacén. El visitante entra por `demo` y salta desde unas pestañas arriba. Son PÚBLICAS igual que la general y llevan sus mismos guards — cambiar `lib/demo/isDemo.js` las cubre a las cuatro. Quién es cada una y con qué módulos, en `lib/demo/demos.js`; se montan y se siembran con `scripts/crear-demos-por-oficio.js`. **No se dan de baja desde el panel**: se rehacen con ese script. |
| `retorika`       | local + prod    | Academia online (WordPress + TutorLMS). |
| `aumenta`        | local + prod    | Centro de psicología y formación, y **el cliente que más usa el CRM**: 12.030 citas, 15 personas y 88 de las 99 integraciones vivas. Overrides de UI: `aumenta/LeadsModule` y `aumenta/FormacionOverview`; el sidebar dice "Interesados" en vez de "Leads". **CRM en uso REAL desde 2026-07-24**: datos de ejemplo borrados (`reset-aumenta-real-data.js`; los LEADS eran reales y se conservaron) y equipo real dado de alta (`seed-aumenta-equipo-real.js`: 13 logins tipo `nombre_aumenta` con rol `user`; dirección usa admin@aumenta.es). Desempeño/Dirección/Productividad son SOLO admin. **NO wipear ni sembrar sin permiso.** **Agenda compartida ENCENDIDA el 01/08/2026** a petición de Rodrigo: todo el equipo ve la agenda completa, y con ella los datos de contacto del paciente. **`analytics` y `nutricion` activados el 13/08/2026** (los dos a petición suya). ⚠️ Nutrición va con el auto-marcado **APAGADO** (`featureFlags.autoAsignarEnAlta`): con 1.083 familias dentro, encenderlo marcaría como paciente de dietas a todo el que entre por la puerta, incluidos los que solo van a terapia. No encenderlo sin que lo pidan, y `backfill-nutricion-assignments.js` respeta el mismo flag para que no entre por la puerta de atrás. |
| `spain_enzymes`  | local + prod    | Cliente real en producción (admin `admin@spain-enzymes.salamandra`). Su web (spainenzymes.com, WordPress) manda los leads del formulario a `/api/public/leads`. **Ojo**: en local tiene módulos que en producción NO ha contratado; no dar por buena la lista de local. |
| `nutri_laura`    | local + prod    | Nutricionista (Laura). Override de leads (embudo nutricional) + conversión lead→paciente + override del overview de formación (B2C, sin TutorLMS aún). Subida a prod el 2026-06-23 con el sprint Recetario C1. **NO tiene `clinica` ni `pacientes`**: sus "pacientes" son `Client` con plan de menú, y por eso el módulo `clients` se le rotula «Pacientes» (ver `lib/clients/vocabulario.js`). |
| `somos`          | prod            | **No estaba en esta tabla hasta el 12/08/2026**, igual que le pasó a healim. Lo que se sabe mirando la base de datos: activo, 21 módulos —todos los que se venden—, sin un solo dato dentro todavía (0 fichas, 0 formularios, 0 leads) y con paleta propia desde el 12/08 (`#124A55` azul petróleo + `#F59C00` naranja, ver `scripts/update-somos-brand.js`). **Quién es y qué no se le puede tocar, que es para lo que sirve esta tabla, sigue sin escribir**: lo sabe Jorge o Rodrigo. |
| `salamandra_solutions` | prod; en local solo la ficha (sin schema `crm_salamandra_solutions`) | **Somos nosotros.** Es el único con el módulo `provisioning`, que es lo que abre el back-office (`/admin`). No es un cliente: no cuenta en los recuentos de las pantallas internas. |

> ⚠️ **La columna «Entorno» también se había desviado** (corregido 12/08/2026):
> decía «solo producción» de `retorika`, `healim` y `salamandra_solutions`, y los
> tres están además en local. Mismo problema que la columna de módulos, en
> pequeño: una lista copiada a mano de algo que cambia. Se comprueba en un
> segundo, y hay que hacerlo antes de fiarse:
>
> ```bash
> node --env-file=.env.local -e "import('./lib/db/masterDb.js').then(async({getMasterDb})=>{const d=getMasterDb();console.log((await d.query('SELECT slug FROM master.tenants ORDER BY slug'))[0].map(t=>t.slug).join(', '));await d.close()})"
> ```

Cada tenant puede tener override de UI en `modules/overrides/{slug}/`
(carpeta con guión) y seed propio en `scripts/seed-{slug}.js` cuando
aplique.

> **Tenants "reina" de cada módulo.** Cada módulo grande tiene un cliente REAL de
> referencia cuyo comportamiento/necesidades definen el default de ese módulo:
> - **`aumenta` = la reina del módulo CLÍNICO** (centro de psicología). Cuando se
>   habla de "cambios en Aumenta" se habla del **módulo clínico**. NO tratar lo
>   clínico como un `overrides/aumenta/`.
> - **`nutri_laura` = la reina del módulo NUTRICIÓN** (Laura).
> - **`demo` = escaparate**, NO es la reina de nada: tiene todos los módulos con
>   datos FALSOS para poder VER las features juntas.
>
> **Un cambio en un módulo se aplica a TODOS los tenants que lo tengan, a la vez**
> (mismo código gated por módulo): un cambio clínico va a Aumenta **y** al resto
> con el módulo (incl. demo), por defecto, "hasta que digamos lo contrario". Los
> `modules/overrides/{slug}/` se reservan para cuando un tenant se desvía DE VERDAD
> del default (UI o lógica propia), no para el comportamiento base del módulo.

> ⚠️ **En Leads la pirámide está al revés, y hay que dejar de alimentarla**
> (Jorge, 18/08/2026). Medido ese día: el módulo base de Leads tiene 94 líneas
> y es una tabla pobre; cada uno de los seis overrides tiene entre 600 y 1.060,
> y son el producto de verdad, copiado seis veces. El comentario del base decía
> «hoy no lo ve nadie» — ya no es cierto: en producción lo ven `somos`,
> `gm_alvar_alonso` y las tres demos por oficio. **Los clientes más nuevos ven
> la peor pantalla.** Y `overrides/nutri-laura/` (6 ficheros, 3.855 líneas, 41
> commits en un mes) no es un override: es la ficha de cliente entera.
>
> Pasó porque copiar era el seguro más barato cuando no había ni pruebas ni
> forma de ver las pantallas. Desde el 18/08 sí las hay (`npm test`, la prueba
> de deriva de etapas, sesión de demo pública para mirar). Reglas desde hoy:
>
> - **Nada nuevo entra en `modules/overrides/`** salvo comportamiento propio de
>   UN cliente. Lo genérico va al módulo base, gateado por módulo o feature flag.
> - **Un dato que el servidor necesita se declara en `lib/`**, no dentro del
>   componente: `lib/leads/embudos.js` es el modelo (declara las etapas de cada
>   tenant, y `_smoke-leads-etapas.mjs` vigila que las copias no se separen).
> - **Los seis overrides NO se unifican de golpe** (decisión de Jorge, 17/08).
>   Se encogen por oportunidad, cuando se toque uno por otro motivo, sacando la
>   pieza compartida al base con su prueba. Nunca un «sprint de refactor».
> - El objetivo es un módulo base digno que lean todos los clientes nuevos, no
>   borrar carpetas.
>
> **Lo que ya encogió** (18/08/2026, misma tarde): el base de Leads pasó a ser
> el de aumenta parametrizado, y con eso los overrides de `demo` y `sandbox`
> —copias del de aumenta sin nada propio— se borraron; la demo enseña el embudo
> por defecto (cinco etapas). Aumenta conserva el suyo a propósito: lo único
> que la separa del base es el rosa `#FF1F96`, y no se le cambia sin que lo
> pida. Y los tres paneles de la ficha de Laura (Historia clínica, Documentos,
> Sesiones) pasaron a `components/clients/`; el base los monta por módulos
> según `lib/clients/piezasFicha.js` —**Aumenta no gana ninguno**, decisión de
> Jorge— y la ficha de Laura los importa de ahí con sus palabras de siempre.
> Quedan cuatro overrides de Leads (aumenta, nutri-laura, retorika,
> spain-enzymes) y la ficha de Laura, que ya es cabecera + tarjeta + pestañas.
>
> **La columna `ui_override` de `master.tenant_modules` es un LETRERO**: el
> código no la lee (la pantalla se elige con el mapa `UI_OVERRIDES` por slug de
> cada página); solo la enseña `/admin/modulos`. Se mantiene fiel con
> `scripts/sincronizar-ui-override.mjs`, que lee la verdad de esos mapas — se
> relanza tras añadir, mover o borrar un override, y en producción va con
> `docker run` montando el repo (la imagen no lleva `app/`; ver su cabecera).

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
| support         | #4 Soporte & Calidad          | Implementado (aumenta, demo, demo_agencia, somos) | `docs/modules/support.md`   |
| billing         | #5 Facturación                | Implementado (demo, aumenta, spain_enzymes)  | `docs/modules/billing.md`   |
| team            | #6 Equipo & RRHH              | Implementado                                 | `docs/modules/team.md`      |
| planning        | #7 Planificación & Recursos   | Pendiente                                    | —                           |
| documents       | #8 Documentación & Contratos  | Implementado (aumenta, demo, demo_clinica, demo_nutricion, nutri_laura, somos; `documents_avanzado` en aumenta, demo y somos) | `docs/modules/documents.md` |
| —               | #9 Filtro global por cliente  | Pendiente (feature transversal, sin menú)    | —                           |
| inventory       | #10 Inventario & Activos      | Implementado (spain_enzymes, demo, aumenta)  | `docs/modules/inventory.md` |
| training        | #11 Formación & Conocimiento  | Implementado (retorika, aumenta)             | `docs/modules/training.md`  |
| automations     | #12 Automatizaciones & Flujos | Pendiente (motor n8n externo, sin módulo UI) | —                           |
| ai              | #13 IA & Asistente            | Pendiente                                    | —                           |
| integrations    | #14 Integraciones & API       | Pendiente (infra parcial: webhooks/external) | —                           |
| analytics       | #15 Analítica & BI            | Implementado — visitas web. Credenciales de Cloudflare POR CLIENTE: sin ellas la pantalla dice «sin configurar» | `docs/modules/analytics.md` |
| communications  | #16 Comunicaciones            | Pendiente (modelos `Message`/`Notification`) | —                           |

### Fuera del plan 1-16 (ya implementados)

| moduleKey     | Módulo                         | Estado                              | Doc detallado               |
| ------------- | ------------------------------ | ----------------------------------- | --------------------------- |
| calendar      | Calendario                     | Implementado (demo, aumenta)        | —                           |
| citas         | Citas (reservas + portal SSO)  | Implementado (nutri_laura, aumenta) | `docs/modules/citas.md`     |
| orders        | Pedidos                        | Implementado (spain_enzymes, aumenta) | —                         |
| ~~referidos~~ | Referidos (formulario público) | **Retirado el 12/08/2026.** Ver abajo | —                        |
| ~~cuestionarios~~ | Cuestionarios (TutorLMS)   | **Ya no es un módulo** (10/08/2026): es una pantalla de Formación, `/formacion/cuestionarios` | (dentro de `training.md`) |
| clients_avanzado | Clientes avanzado: lista de espera de admisión (aumenta, demo) | Implementado | — |
| pacientes     | Pacientes                      | Implementado (aumenta)              | `docs/modules/pacientes.md` |
| clinica       | Clínica                        | Implementado (aumenta)              | `docs/modules/clinica.md`   |
| nutricion     | Recetario                      | Implementado. **Deja de ser exclusivo de Laura el 13/08/2026**: sus componentes viven en `modules/nutricion/` (no en `overrides/nutri-laura/`), la pestaña «Pautas» la monta la ficha por defecto, y `enable-module.js <slug> nutricion` crea las nueve tablas y siembra los 497 alimentos base. Activo en `nutri_laura`, `demo`, `somos` y `aumenta` | `docs/modules/nutricion.md` |
| outreach      | Captación (leads + scoring IA) | Implementado (aumenta, demo, demo_agencia, salamandra_solutions, somos) | `docs/modules/outreach.md` |
| formularios   | **Leads Comerciales**: formularios públicos → bandeja → ficha (antes «Formularios») | Implementado (nutri_laura) | `docs/modules/formularios.md` |
| —             | Configuración (ajustes + claves IA por tenant) | Implementado (siempre visible, sin `moduleKey`) | `docs/modules/configuracion.md` |
| —             | **Buzón**: el cliente nos escribe a NOSOTROS (`/ayuda` → `/admin/buzon`) | Implementado 13/08/2026 (todos los clientes, sin `moduleKey`) | `docs/modules/buzon.md` |

### Módulos nuevos (2026-07-27/28)

| moduleKey | Módulo | Notas |
| --- | --- | --- |
| `team` | **Equipo básico** | Plantilla, altas, usuarios del CRM, roles y accesos por módulo. Es lo que necesita cualquier cliente. |
| `team_avanzado` | **Equipo avanzado** | Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación y Actividad. Se vende aparte; los submenús exigen `requiresAll` (avanzado + el módulo que aporta el contenido) y sus 16 endpoints lo comprueban. |
| `documents` | **Documentos básico** | Solo el Contrato de Prestación de Servicios del centro. Es lo que necesita un cliente que no quiere un gestor documental (nutri_laura). |
| `documents_avanzado` | **Documentos avanzado** | El archivo completo: carpetas, buscador, subida general y cuota. Mismo patrón que `team`/`team_avanzado`; los endpoints de `/api/documents/*` lo exigen. |
| `fichaje` | **Fichaje** | Control horario: se vuelca el Excel del reloj de fichar cada mes. **Universal por dentro y de cada cliente por fuera**: el módulo es el mismo para todos y lo único que cambia es el LECTOR del Excel (`lib/fichaje/parsers/`), porque cada reloj escupe un formato distinto. Añadir un cliente = un fichero ahí y una línea en `POR_TENANT`. Requiere `team` y NO `team_avanzado` a propósito: los submenús del avanzado exigen además `clinica`, y eso dejaría el control horario invendible a quien solo quiere Equipo. |
| `provisioning` | **Alta de clientes** | Panel interno SOLO de `salamandra_solutions`: crea el cliente entero (schema, tablas, módulos con dependencias, admin, marca y datos fiscales) y lo acompaña hasta el final — editarlo, suspenderlo, ponerle las credenciales y CERRARLE la cuenta. `lib/provisioning/`. |

> **El ciclo de vida de un cliente, en un sitio** (13/08/2026). `lib/provisioning/`
> tiene cuatro piezas y conviene saber cuál es cuál antes de tocar ninguna:
> `altaTenant.js` lo crea, `cicloVida.js` lo edita/suspende/reactiva,
> `credencialesCliente.js` le pone las claves (solo escribir: nada de esto las
> LEE nunca) y `bajaTenant.js` lo cierra.
>
> La baja **aparta, no destruye**: renombra el schema a `zzz_baja_<slug>_<fecha>`
> y mueve sus ficheros a `uploads/_bajas/<slug>_<fecha>/`, dejando un
> `.rollback.sql` que lo devuelve todo. Es reversible, y por eso puede ser un
> botón. **Destruir de verdad sigue siendo SSH** y no tiene endpoint:
> `scripts/borrar-tenant.js <slug> --purgar`. El motivo no es solo prudencia —
> las facturas tienen obligación legal de conservarse años y los registros de
> auditoría no se borran nunca; apartar convive con las dos cosas y purgar no.
>
> La red de rescate lleva los `password_hash` de sus usuarios sobre disco, así
> que caduca: `scripts/podar-bajas.js` (90 días por defecto), y la purga se
> lleva la del cliente que purga.

> **ACTIVAR UN MÓDULO TIENE DOS PUERTAS** (01/08/2026, después de tropezar dos
> veces). No basta con `master.tenant_modules`: si el usuario tiene una lista
> explícita en `users.module_access`, el sidebar le oculta el módulo y la API le
> responde 403 aunque el cliente lo tenga contratado. Pasó con `analytics` en
> spain_enzymes (31/07) y con `documents` en nutri_laura (01/08); las dos veces
> lo detectó el cliente, no nosotros.
>
> - `scripts/enable-module.js <slug> <moduleKey>` da acceso a los **admin**
>   automáticamente (`--sin-admins` para evitarlo) y avisa de los usuarios
>   normales, que se dan con `--grant-users`.
> - `npm run db:check-access` (solo lectura) lista quién no ve qué en TODOS los
>   clientes. Lanzarlo tras activar módulos y en cada despliegue que los toque.

⚠️ **Retirados del menú (2026-07-27)**: `analytics`, `ai`, `automations`,
`integrations` — eran entradas sin página detrás y llevaban a un 404 en mitad
de una demo. Se vuelven a añadir cuando exista su página.

✅ **`analytics` reincorporado (2026-07-31)**: ya tiene página (`/analiticas`) y
endpoint (`/api/analiticas`), así que cumple la condición. Vuelve dentro del
área **Comercial** (junto a Leads), no en el grupo "Inteligencia", que sigue
desaparecido. `ai`, `automations` e `integrations` continúan fuera.

> **`leads` vs `sales`**: había dos `moduleKey` para el área comercial y el
> código aceptaba los dos (`hasModule("leads") || hasModule("sales")` en dieciséis
> guardas). **`sales` se retiró el 12/08/2026**: la única clave del área comercial
> es `leads`.
>
> No era limpieza, era un cambio de AUTORIZACIÓN, así que primero se comprobó
> contra producción que no dejaba a nadie fuera: de las ocho filas comerciales de
> `master.tenant_modules`, siete son `leads` y están activas, y la única `sales`
> es la de la demo y está **apagada**; ningún usuario tenía `sales` en su
> `module_access`. Esa fila apagada sigue ahí y no molesta — la sembró
> `scripts/db-sync.js`, que tenía `sales` y no tenía `leads` en su lista de
> módulos, y que se arregló en el mismo cambio.
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
> activa): `planning`, `ai`, `automations`, `integrations`.

### Pantallas nuevas del sprint Aumenta (31/07 - 01/08/2026)

No son `moduleKey` nuevos: cuelgan de módulos que ya existen y viajan con ellos
a todos sus tenants. Detalle en `docs/sprint-aumenta-2026-07.md`.

| Pantalla | Ruta | Cuelga de |
| --- | --- | --- |
| Coordinaciones (listado general + alta) | `/clinica/coordinaciones` | `clinica` |
| Estadísticas del centro (Excel + PDF, solo dirección) | `/clinica/estadisticas` | `clinica` |
| Lista de espera de admisión | `/clientes/lista-espera` | `clients_avanzado` |
| Contrato, tutores y meses del portal | ficha de cliente | `clients` |
| Morosidad | dentro de `/facturacion/cobros` | `billing` |
| Fichas a completar (huecos de datos por carpetas) | `/clientes/urgentes` | `clients_avanzado` |

⚠️ **«Fichas a completar»** (03/08/2026, tras migrar Aumenta) sale de
`lib/clients/urgentes.js`, que define las CARPETAS y sus consultas en un solo
sitio: el total de la carpeta y las filas que se ven al abrirla TIENEN que salir
de la misma fuente, o nadie se fía del número. Dos bloques —lo que bloquea el
trabajo (decenas) y la ficha incompleta (miles)— porque una lista que no se
puede terminar deja de mirarse. Las filas se archivan con `data_reviews`
(«esto ya lo he mirado y está bien»): sin eso no llega a cero nunca, porque hay
huecos correctos —un paciente en lista de espera no tiene terapeuta—. Las
carpetas no se solapan a propósito.

⚠️ **Cuelga de `clients_avanzado`, no de `clients`** (Rodrigo, 04/08/2026).
Nació con `clients` a secas y por eso le salió a TODOS los clientes con fichas,
incluido nutri_laura, que no lo había pedido. La pantalla resuelve el problema
de un centro que importó 1.083 familias y arrastra miles de huecos, no el de
una consulta de una persona que conoce a sus pacientes por el nombre. Gatean
las TRES puertas: el menú (`Sidebar.jsx`), la página —server component que hace
`notFound()`, como Lista de espera— y el endpoint. Solo el menú no basta: con
la URL guardada se seguiría sacando el listado entero.

### El alta de clientes se adapta al cliente (01/08/2026)
`lib/clients/formularioAlta.js` decide QUÉ se pregunta, y lo comparten la
pantalla y el endpoint. Dos perfiles, por MÓDULOS y no por slug, para que un
centro nuevo salga bien de fábrica:

| Perfil | Cuándo | Campos | Tipo de cliente |
| --- | --- | --- | --- |
| `salud` | tiene `pacientes`, `clinica` o `nutricion` | sin Empresa/Tema/Producto | `individual` |
| `comercial` | el resto | como estaba | `company` |

**Código postal para todos**, en `customFields.postalCode` (no en `fiscalZip`:
recepción apunta dónde vive la familia, no dónde factura). **Tema y Producto de
interés se han quitado de todos los formularios, del Excel y del importador**
(01/08/2026): no había un solo cliente con ellos rellenos en producción, y las
notas internas de la ficha cubren lo que hiciera falta.

⚠️ **`Client.address` es JSONB, no texto.** Un campo «Dirección» de texto en la
ficha metió el `{}` por defecto como hijo de React y tumbó la pantalla entera —
compilaba y el servidor devolvía 200; solo se veía abriendo la ficha dos veces.
Si algún día se pide la dirección completa, hay que tratarla como el objeto que
es.

Con `pacientes` activo, el alta crea también a los pacientes **en la misma
transacción** (`components/clients/PacientesDelAlta.jsx`): o entra la familia
con sus pacientes, o no entra nada. La casilla «el paciente es el propio
cliente» PRERRELLENA nombre y apellidos partiendo el nombre del cliente — a la
vista y editables, sin adivinar nada por detrás.

Con `clients_avanzado` activo, una casilla mete a la familia en la cola de
admisión (`lib/clients/listaEspera.js`). Esa entrada queda **`active` con
`clientId`**, que antes no pasaba: `converted` significa «ya tiene plaza» y la
sacaría de la cola el mismo día. Por eso la lista ofrece «Ya tiene plaza» en vez
de «Convertir en cliente» a quien ya tiene ficha. La ficha enseña «En lista de
espera desde el …» en su cabecera.

### Clientes se llama «Pacientes» en la consulta de nutrición (04/08/2026)
`lib/clients/vocabulario.js` decide el rótulo del módulo `clients` y lo dicen
igual el sidebar, la pantalla `/clientes`, la portada y el `<title>` del
navegador: **Pacientes** donde el cliente ES el paciente (tiene `nutricion` y
NO tiene `pacientes` ni `clinica`), **Clientes** en el resto. Por MÓDULOS, no
por slug, igual que el formulario de alta.

⚠️ La condición negativa es lo importante: en un centro clínico el cliente es
la familia que paga y los pacientes son los hijos, que ya tienen su tabla y su
propia entrada de menú. Sin ella, Aumenta y demo tendrían **dos «Pacientes»
distintos en el mismo sidebar**. Hoy solo cumple `nutri_laura`.

De ahí salen dos renombrados más en el módulo Nutrición (y por tanto en
`nutri_laura` **y** `demo`): «Recetas» → **Recetario** y «Pacientes» →
**Pautas** (el submenú de `/nutricion/asignados`, que ya no podía llamarse
igual que el módulo de arriba). Y las pestañas de la ficha de nutri_laura
pasan a **Datos · Historia clínica · Documentos · Sesiones · Pautas**. Todo
son rótulos: ni rutas, ni claves, ni endpoints, ni tablas se han movido, y por
dentro las pantallas de nutrición siguen hablando de «plan» y «menú».

### Leads: dos orígenes, un solo grupo (01/08/2026)
`leads` y `formularios` son **submódulos de Leads** y se nombran por su origen:

| Módulo | Se llama | Sidebar | Ruta | Qué es |
| --- | --- | --- | --- | --- |
| — | Leads (el grupo) | «Leads» | `/leads/estadisticas` | Estadísticas: lo único que mira los dos orígenes juntos. |
| `leads` | Leads Profesionales | «Profesionales» | `/leads` | El embudo por etapas: quien deriva o pregunta. |
| `formularios` | Leads Comerciales | «Comerciales» | `/formularios` | Quien llega por la web, a una bandeja de aceptación. |

En el menú van SIN la palabra «Leads» delante (ya la pone el grupo); dentro de
cada pantalla, completa. `formularios` ahora **requiere `leads`**: una bandeja
de comerciales sin embudo donde caer no es un producto.

⚠️ **El padre del grupo NO es `/leads`**: es la pantalla de estadísticas. El
embudo no se movió de `/leads` porque tiene ocho overrides por tenant colgando
de esa ruta. Quien no tenga `formularios` ve el bloque de comerciales
directamente ausente, no a cero.

Aumenta y sandbox llaman «Interesados» al grupo por override de tenant
(`TENANT_LABEL_OVERRIDES`), y sus hijos se llaman igual que en todas partes.

⚠️ **La «lista de espera» de Citas y la de admisión son cosas distintas**: la
primera son solicitudes de reserva concretas (`bookings` en `pending`); la
segunda, gente esperando plaza sin cita ni fecha. Por eso la segunda lleva
apellido en toda la UI.

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
    - ⚠️ **SINCRONIZAR SIEMPRE ANTES, Y PREGUNTAR SI ALGO SE SOLAPA**
      (13/08/2026). Aquí trabajan DOS personas empujando a `master` sin PRs que
      avisen: el 13/08, en una sola hora, entraron `25c7771` y `94a6d3f` mientras
      había trabajo a medias en local. Antes de commitear nada:

      ```bash
      git fetch origin && git diff --name-only HEAD origin/master
      ```

      Si ninguno de esos ficheros es tuyo, `git pull --ff-only` y adelante. **Si
      alguno coincide, PARA Y PREGUNTA** qué hacer — no lo resuelvas por tu
      cuenta aunque el conflicto parezca trivial. Lo que se ve en un diff es el
      texto, no la intención: dos cambios pueden fusionar limpiamente y ser
      incompatibles igual, y quien puede saberlo es quien escribió el otro.
      Enseña las dos versiones y espera.
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
    **Y sin filtrar por `status`** (12/08/2026): el estado decide quién PUEDE
    ENTRAR, no qué FORMA tiene su schema. Filtrar por `status = 'active'` deja a
    los clientes suspendidos congelados en el schema del día que se apagaron, y
    en silencio —como suspender los apaga de verdad, nadie choca con nada hasta
    que se reactivan—. Se descubrió en producción con `quality_energy` (22
    columnas de retraso en 7 tablas) y `abarcaia` (20 en 6), mientras los siete
    activos estaban al día. Es el incidente del 2026-07-21 con otro disfraz:
    elegir schemas por una condición de NEGOCIO en vez de por lo que hay en la
    base de datos.
    - `scripts/_schema-targets.js` (lo usan 43 de las 103 migraciones) ya no
      mira el estado, ni en `byTable` ni en `byModule`.
    - Las otras 30, que llevaban su propio `WHERE status = 'active'` copiado a
      mano, se barrieron el mismo día. `fetchActiveSlugs` pasó a llamarse
      `fetchTargetSlugs` donde existía: el nombre habría empezado a mentir.
    - Reactivar un cliente pone además su schema al día solo
      (`lib/provisioning/cicloVida.js`), que es el momento en que el retraso
      pasa de inofensivo a 500 en pantalla.
    - Una migración nueva usa el helper. Si por lo que sea no puede, que su
      consulta no mire `status`.

    > **Ojo: esto vale para la ESTRUCTURA, no para los datos.** Un seed o un
    > backfill (`seed-foods-base-catalog.js`, `backfill-nutricion-assignments.js`,
    > `reset-aumenta-real-data.js`) sí debe seguir mirando `status`: sembrar
    > datos en un cliente apagado no arregla nada y puede ensuciar lo que había.
13. En diseño responsivo, todo modal o panel lateral (drawer) debe respetar la
    barra superior móvil del dashboard (`h-14`, ~56px, `lg:hidden`) que contiene
    el botón del menú hamburguesa. Patrón: `top-14 lg:top-0 ... bottom-0`
    (en lugar de `top-0 h-full`). Aplica al módulo Equipo, Leads y cualquier
    otro nuevo o existente que abra paneles encima de la página.
    **Capas (z-index), decisión del socio 2026-07-27**: los overlays usan
    backdrop `z-40` + panel `z-50`; los widgets flotantes (campana de
    notificaciones, Salamandrobot) van a `z-30`, POR DEBAJO — al abrir
    cualquier drawer o modal quedan tapados y no pisan botones. Todo drawer o
    modal nuevo debe seguir esa escala.
14. **La CONFIGURACIÓN es UNIVERSAL** (Rodrigo, 01/08/2026). Las tarjetas de
    integración de Configuración —WhatsApp, Cloudflare, Anthropic, OpenAI,
    Google Places, Resend— y los interruptores del tenant se muestran en
    **TODOS los clientes**, usen o no ese servicio: nada de gatearlos por
    módulo. Quien mañana quiera conectar WhatsApp o la analítica de su web
    tiene que poder hacerlo solo, sin que nadie toque código. Lo que sí depende
    del módulo es la FUNCIÓN (la pantalla, el endpoint), no el sitio donde se
    pegan las credenciales.
15. **Secrets de producción NUNCA pasan por chats con LLMs ni por canales no seguros**.
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
- **El rol SIEMPRE se lee fresco de BD** (arreglo 2026-07-28). El middleware
  copia el rol del JWT (15 min de vida) a `x-user-role`, pero `withTenant`
  reescribe esa cabecera con el rol real antes de llamar al handler, mediante un
  proxy que delega todo lo demás (cuerpo, cookies, url) en el request original.
  Así degradar o dar de baja a alguien surte efecto AL INSTANTE en los ~90
  endpoints que gatean por esa cabecera, sin tocarlos uno a uno.
- JWT en httpOnly cookies — nunca localStorage.
- Refresh token con rotación.
- Rate limiting en endpoints de auth. **El cerrojo duro va por CUENTA+IP**
  (`lib/auth/loginGuard.js`, revisado 2026-07-28), nunca por cuenta a secas: el
  429 salta ANTES de comprobar la contraseña, así que un cerrojo global a la
  cuenta convertía 6 peticiones cada 15 min en un DoS gratuito contra una
  persona concreta (los logins de Aumenta son adivinables: `nombre_aumenta`).
  El cerrojo por cuenta global existe pero con umbral POR ENCIMA del de IP,
  para que solo lo alcance un ataque distribuido.
- **Un endpoint nuevo que envíe correo, gaste IA o escriba en master necesita
  su guard de `lib/demo/isDemo.js`**. La demo es pública y da sesión de ADMIN a
  visitantes anónimos: sin el guard, cualquiera con el enlace usa el CRM como
  relé (en la auditoría del 2026-07-28 apareció el envío de facturas por correo,
  que salía con la clave global de Resend y desde nuestro dominio verificado).

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
- Logs de auditoría nunca se borran ni modifican (salvo la retención por
  antigüedad de `scripts/podar-audit-logs.js`: demo 7 días, clientes reales 3
  años con suelo de 1 año).
- **Auditar SIEMPRE lo destructivo y lo que mueve dinero** (2026-07-28). Helper
  genérico `lib/utils/auditoria.js` (o el de cada módulo si ya existe:
  citas, clínica, documentos, facturación). Reglas:
  - Se llama DESPUÉS de la mutación y FUERA de la transacción: la auditoría
    escribe en master con otra conexión, y dentro dejaría rastro de un cambio
    que un rollback deshiciera.
  - Se guarda un RESUMEN de la fila, nunca la fila entera: en clientes,
    tickets y pacientes hay datos personales (y de salud) que no deben
    duplicarse en la tabla de master, compartida por todos los clientes.
  - Cada acción nueva necesita su frase en `lib/actividad/etiquetas.js`, o
    saldrá con el traductor genérico en Equipo → Actividad.
  - **Los campos del resumen tienen que existir EN ESE modelo.** Sequelize solo
    hace SELECT de los atributos definidos, así que leer un campo que el modelo
    no expone devuelve `undefined` en silencio y la auditoría sale muda o con
    el `before` y el `after` idénticos. En el repaso del 2026-07-28 fallaban 11
    de 15 sitios (p. ej. `Cost` no tiene `amount` —es legacy en BD, fuera del
    modelo a propósito— ni `date` ni `method`, así que borrar un gasto de
    12.000 € no dejaba rastro del importe).
  - Deliberadamente SIN auditar: la edición granular de un menú de nutrición
    (comidas, opciones, alimentos) — el plan ya audita created/updated y
    auditar cada alimento generaría cientos de filas sin valor.

---

## Conexión cliente/equipo — sprint 2026-07-23

Principio: **todo registro del CRM tiene un CLIENTE (externo, para quién es) y
un miembro del EQUIPO (interno, quién lo hace/posee)**. Los módulos se
construyeron independientes y varios cruzaban por texto/email en vez de por FK
real, lo que dejaba registros huérfanos en silencio (p. ej. citas de Aumenta
sin cliente durante meses, porque el cruce ficha↔cita era por email).

Enlaces reales añadidos (todos UUID nullable, FK ON DELETE SET NULL):

| Tabla | Columna nueva | Enlace |
| --- | --- | --- |
| `bookings` | `client_id` | cita → ficha (sprint citas) |
| `documents` | `client_id` | documento → cliente |
| `clinic_sessions` | `client_id` | sesión → cliente (foto del paciente) |
| `clinical_reports` | `client_id` | informe → cliente |
| `coordinations` | `client_id` | coordinación → cliente |
| `plans` | `team_member_id` | plan → nutricionista |
| `interactions` | `team_member_id` | interacción → autor |
| `client_notes` | `team_member_id` | nota → autor |
| `form_submissions` | `handled_by_team_id` | solicitud → quién la atendió |

Los registros clínicos toman `client_id` del paciente al crearse (foto, no se
resincroniza) para no depender del salto paciente→cliente, que es frágil
(`patients.client_id` es nullable y a menudo vacío).

Auto-relleno en el alta: `lib/team/currentTeamMember.js` resuelve el TeamMember
del usuario logueado (por `x-user-id`); `lib/clinica/patientClient.js` resuelve
el cliente de un paciente. Los campos de texto viejos (`created_by`,
`handled_by`) se conservan por compatibilidad.

**Chequeo de salud**: `npm run db:check-links` (solo lectura) recorre los
schemas y cuenta registros sueltos por tabla. Es la red que faltaba: nada
avisaba cuando algo se quedaba sin conectar. Lanzarlo tras cada sprint que
toque estos módulos.

**Reparación del histórico (2026-07-27)**: existe
`scripts/backfill-patients-client.js` (ONE_OFF, dry-run por defecto). Deduce el
pagador de las PROPIAS citas/sesiones/informes del paciente y enlaza solo si
todas coinciden en el mismo cliente; los ambiguos (padres separados) se listan
para revisión humana. NO cruza por nombre a propósito: el cliente es el tutor
que paga y confundir familias sería una fuga de datos clínicos. Deja un
`.rollback.sql` con las filas exactas que tocó.

Estado real comprobado en producción el 2026-07-27: **`aumenta` no tiene ningún
paciente suelto** (de hecho `check-links` lo da como "todo conectado"), porque
el reset del 24-jul dejó el módulo clínico vacío y los pacientes nuevos ya
nacen enlazados. Los únicos huérfanos están en `demo`/`demo_golden` (datos
falsos, sin ninguna prueba de la que deducir el pagador). El script queda como
red para cuando Aumenta empiece a cargar pacientes de verdad.

Pendiente (fuera de este sprint): llevar estos enlaces a la UI (mostrar y
reasignar el cliente desde cada ficha).
