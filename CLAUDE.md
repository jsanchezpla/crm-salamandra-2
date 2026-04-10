# Contexto proyecto — CRM SaaS Salamandra Solutions (V3)

## Quién soy

Soy Jorge, informático de Salamandra Solutions. Estoy construyendo un CRM SaaS
multi-tenant para vender como producto a empresas cliente. Actúas como mi
arquitecto y senior developer de referencia en este proyecto.

---

## Stack técnico — DEFINITIVO

- **Frontend + Backend:** Next.js 16 (App Router + Route Handlers) — sin Express
- **Base de datos:** PostgreSQL
- **ORM:** Sequelize (familiar para el equipo, probado en proyectos anteriores)
- **Multi-tenant:** Schema por tenant en PostgreSQL (`crm_{slug}`)
- **Despliegue:** VPS propio
- **Automatizaciones:** n8n (instancia propia)
- **IA:** API OpenAI

> ⚠️ El proyecto anterior usaba MongoDB + Mongoose + Express. Ese stack está
> descartado. El proyecto nuevo empieza desde cero con el stack anterior.

---

## Entorno de desarrollo

- Editor: VS Code
- Linter: ESLint 9 (flat config — `eslint.config.mjs`)
- Formatter: Prettier 3 (`eslint-config-prettier` + `eslint-plugin-prettier`)
- Estilos: Tailwind CSS 4
- Terminal: PowerShell (Windows) — usar sintaxis PowerShell, no bash

### Configuración de herramientas

**`package.json` devDependencies:**

```json
{
  "eslint": "^9",
  "eslint-config-next": "16.1.6",
  "eslint-config-prettier": "^10.1.8",
  "eslint-plugin-prettier": "^5.5.5",
  "prettier": "^3.8.1",
  "tailwindcss": "^4.2.1",
  "@tailwindcss/postcss": "^4.2.1",
  "autoprefixer": "^10.4.27",
  "postcss": "^8.5.6"
}
```

**`eslint.config.mjs`:**

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
  ...nextVitals,
  prettierConfig,
  {
    plugins: { prettier: prettierPlugin },
    rules: { "prettier/prettier": "error" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```

**`.prettierrc`:**

```json
{
  "singleQuote": false,
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

**`.vscode/settings.json`:**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[javascriptreact]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[typescriptreact]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "never" },
  "eslint.format.enable": false
}
```

---

## Arquitectura — decisiones tomadas y cerradas

### Modelo multi-tenant

- Una sola app Next.js desplegada para todos los clientes
- Una sola base de datos PostgreSQL: `salamandra`
- Cada tenant tiene su propio schema dentro de esa DB: `crm_{slug}`
- Schema `master` con configuración global de la plataforma
- El slug del tenant se identifica por subdominio, header `x-tenant` o JWT

```
PostgreSQL DB: salamandra
├── schema: master          ← tenants, users, tenant_modules, audit_log
├── schema: crm_demo        ← datos del tenant de desarrollo
├── schema: crm_acme        ← datos del cliente Acme
└── schema: crm_cliente2    ← datos de otros clientes
```

### Motor de personalización por tenant

Cada cliente puede tener, módulo a módulo:

- Campos extra en el schema (`schemaExtensions`) — guardados en JSONB
- Comportamiento distinto (`logicOverrides`) — guardados en JSONB
- Componente React distinto (`uiOverride`) — nombre del componente alternativo
- Features en prueba (`featureFlags`) — guardados en JSONB

Todo esto vive en la tabla `tenant_modules` del schema `master`.
Al modificar config de un tenant se llama a `invalidateTenantCache(slug)`.

### Control de despliegues

Salamandra decide qué clientes reciben cada actualización mediante
`featureFlags` y el campo `version` en `tenant_modules`.

---

## Infraestructura — ficheros en `/lib` (no tocar sin justificación)

### `lib/db/sequelize.js`

Factoría base de instancias Sequelize. Recibe un schema y devuelve
una instancia configurada con ese searchPath.
No usar directamente — usar `masterDb.js` o `tenantDb.js`.

### `lib/db/masterDb.js`

Conexión singleton al schema `master` con sus modelos ya inicializados.
Exports: `getMasterDb()`, `getMasterModels()` → { Tenant, User, TenantModule, AuditLog }

### `lib/db/tenantDb.js`

Pool de conexiones Sequelize por tenant. Una instancia por schema,
cacheada en Map. Purge automático de conexiones idle cada 5 min.
Exports: `getTenantDb(slug)`, `closeAllConnections()`, `getPoolStats()`

### `lib/tenant/tenantResolver.js`

Helper para Next.js App Router. Resuelve el tenant desde subdominio,
header `x-tenant` o JWT. Carga config desde master y la cachea 60s.
Exports: `getTenantContext(request)`, `invalidateTenantCache(slug)`

Contexto que devuelve:

- `tenant` — datos del tenant
- `tenantModels` — modelos Sequelize del schema del tenant
- `hasModule(moduleKey)` → Boolean
- `getLogicOverride(moduleKey, key)` → valor o null
- `hasFeatureFlag(moduleKey, flagKey)` → Boolean

### `lib/tenant/tenantCache.js`

Caché en memoria con TTL 60s. Sin dependencias externas.

---

## Modelos del schema `master`

Todos en `models/master/`. Definidos como funciones que reciben
una instancia Sequelize y devuelven el modelo.

- `Tenant` — id (UUID), name, slug, dbName, plan, status, settings (JSONB)
- `User` — id (UUID), email, passwordHash, role, tenantId, moduleAccess, lastLoginAt
- `TenantModule` — id, tenantId, moduleKey, enabled, version, schemaExtensions,
  logicOverrides, uiOverride, featureFlags (todos JSONB donde aplica)
- `AuditLog` — id, tenantId, userId, action, entity, entityId, before, after, ip

---

## Modelos del schema tenant

Todos en `models/tenant/`. Se cargan dinámicamente al crear
la conexión del tenant en `tenantDb.js`.

- `Client` — clientes individuales y empresas, incluye acceso portal
- `Contact` — contactos por rol asociados a cliente
- `Lead` — oportunidades con stages y probability
- `Project` — proyectos con columnas Kanban personalizables
- `Task` — tarjetas del Kanban (columnId, order, checklist)
- `Ticket` — incidencias con mensajes tipo chat embebidos
- `Invoice` — facturas con líneas, IVA, PDF, facturantiaId, qrUrl, verifactuStatus
- `TeamMember` — perfil extendido del user en el tenant
- `Asset` — inventario (equipos, licencias, materiales)
- `Training` — formación y certificados por usuario
- `Notification` — notificaciones por canal único
- `Message` — chat interno del equipo por canal

---

## Módulos del CRM — 17 módulos planificados

| moduleKey      | Módulo                        | Estado    |
| -------------- | ----------------------------- | --------- |
| clients        | #1 Clientes & Cuentas         | Pendiente |
| sales          | #2 Comercial & Ventas         | Pendiente |
| projects       | #3 Proyectos (Kanban)         | Pendiente |
| support        | #4 Soporte & Calidad          | Pendiente |
| billing        | #5 Facturación                | Pendiente |
| team           | #6 Equipo & RRHH              | Pendiente |
| planning       | #7 Planificación & Recursos   | Pendiente |
| documents      | #8 Documentación & Contratos  | Pendiente |
| —              | #9 Filtro global por cliente  | Pendiente |
| inventory      | #10 Inventario & Activos      | Pendiente |
| training       | #11 Formación & Conocimiento  | Pendiente |
| automations    | #12 Automatizaciones & Flujos | Pendiente |
| ai             | #13 IA & Asistente            | Pendiente |
| integrations   | #14 Integraciones & API       | Pendiente |
| analytics      | #15 Analítica & BI            | Pendiente |
| communications | #16 Comunicaciones            | Pendiente |
| client_portal  | #17 Portal del Cliente        | Pendiente |

---

## Decisiones técnicas clave ya tomadas

### Facturación — Verifactu

- Implementación propia descartada (4-6 meses, riesgo legal, multas 150k€)
- Solución elegida: **API de Facturantia** (10€/mes, incluye Verifactu)
- Flujo: CRM crea factura → llama Facturantia API → recibe qrUrl y número
  → genera PDF con QR tributario y texto VERI\*FACTU
- Clientes en territorio común (Madrid, Cataluña, Andalucía, etc.)
- Volumen estimado: 100-500 facturas/mes entre todos los clientes
- Campos extra en Invoice: `facturantiaId`, `qrUrl`, `verifactuStatus`, `verifactuSentAt`

### Automatizaciones

- No construir motor de reglas propio
- Usar n8n como motor externo
- CRM dispara webhooks → n8n gestiona la lógica Si X entonces Y

### IA

- API OpenAI para informes en lenguaje natural y sugerencias de calendario
- Patrón: datos del tenant a JSON → prompt → parsear respuesta → pintar resultado

---

## Estructura de carpetas

```
salamandra-crm/
│
├── app/
│   ├── (auth)/
│   │   ├── login/page.jsx
│   │   └── layout.jsx
│   ├── (dashboard)/
│   │   ├── layout.jsx
│   │   ├── clients/page.jsx
│   │   ├── sales/page.jsx
│   │   ├── projects/page.jsx
│   │   └── [...module]/page.jsx
│   ├── portal/
│   │   ├── layout.jsx
│   │   └── page.jsx
│   └── api/
│       ├── clients/
│       │   ├── route.js
│       │   └── [id]/route.js
│       └── [...resto de módulos]
│
├── lib/
│   ├── db/
│   │   ├── masterDb.js
│   │   ├── tenantDb.js
│   │   └── sequelize.js
│   ├── tenant/
│   │   ├── tenantResolver.js
│   │   ├── tenantCache.js
│   │   └── withTenant.js
│   └── utils/
│       ├── apiResponse.js
│       └── errors.js
│
├── models/
│   ├── master/
│   │   ├── Tenant.model.js
│   │   ├── User.model.js
│   │   ├── TenantModule.model.js
│   │   └── AuditLog.model.js
│   └── tenant/
│       ├── Client.model.js
│       ├── Contact.model.js
│       ├── Lead.model.js
│       ├── Project.model.js
│       ├── Task.model.js
│       ├── Ticket.model.js
│       ├── Invoice.model.js
│       ├── TeamMember.model.js
│       ├── Asset.model.js
│       ├── Training.model.js
│       ├── Notification.model.js
│       └── Message.model.js
│
├── modules/
│   ├── clients/
│   │   └── ClientsModule.jsx
│   ├── projects/
│   │   └── ProjectsModule.jsx
│   └── overrides/
│       └── {slug}/
│           └── CustomModule.jsx
│
├── components/
│   ├── ui/
│   ├── layout/
│   └── shared/
│
├── hooks/
│   ├── useTenant.js
│   └── useModule.js
│
├── middleware.js
├── .env.local
├── .prettierrc
├── .prettierignore
├── eslint.config.mjs
└── next.config.js
```

---

## Variables de entorno (`.env.local`)

```env
DATABASE_URL=postgresql://user:password@localhost:5432/salamandra
NODE_ENV=development
JWT_SECRET=tu_secreto_aqui
JWT_EXPIRES_IN=7d
OPENAI_API_KEY=sk-...
FACTURANTIA_API_KEY=...
FACTURANTIA_API_URL=https://api.facturantia.com
N8N_WEBHOOK_URL=https://tu-n8n.dominio.com/webhook
```

---

## Reglas de trabajo

1. Antes de crear un fichero, verificar si ya existe algo similar
2. No modificar ficheros de `/lib/` sin explicar el motivo
3. Schemas base de tenant → `models/tenant/`
4. Overrides de UI por cliente → `modules/overrides/{slug}/`
5. Cambios que afecten a la arquitectura multi-tenant → consultar antes de implementar
6. Cada módulo nuevo sigue el patrón: modelo → endpoints → frontend
7. Siempre usar `getTenantContext` en las rutas — nunca conectar directamente
   a PostgreSQL sin pasar por el resolver
8. Los comandos de terminal son PowerShell (Windows), no bash
9. No usar TypeScript — el proyecto es JavaScript puro
10. No usar `src/` — la carpeta `app/` está en la raíz del proyecto

---

## Skills disponibles

Usa estas skills automáticamente cuando corresponda, sin que tenga que pedírtelo:

- **frontend-design** — cualquier componente React, página, layout o elemento UI
- Todos los componentes deben ser mobile-first con Tailwind
  (diseñar primero para móvil y escalar con sm:, md:, lg:)
- El CRM en desktop es prioritario, pero el portal del cliente
  (#17) debe funcionar perfectamente en móvil
- **xlsx** — exportaciones de datos, informes en Excel
- **docx** — generación de documentos Word (contratos, informes)
- **pdf** — generación de facturas o documentos PDF
- **file-reading** — cuando se suba un fichero para analizar o procesar

---

## Seguridad — reglas obligatorias en todo el proyecto

Estas reglas se aplican siempre, en todos los ficheros, sin excepción.

### Autenticación y autorización

- Validar siempre el JWT antes de resolver el tenant — nunca fiar el slug de una URL sin verificar
- Los tokens JWT nunca se guardan en localStorage — usar httpOnly cookies
- Implementar refresh token con rotación
- Rate limiting en todos los endpoints de auth (login, registro, reset password)

### Aislamiento de datos entre tenants

- Nunca hacer queries sin pasar por `getTenantContext` — directo a PostgreSQL prohibido
- Verificar siempre que el recurso solicitado pertenece al tenant activo antes de devolverlo
- Los schemas de PostgreSQL son la primera barrera — nunca mezclar conexiones entre tenants
- En cada endpoint, validar que el usuario tiene acceso al módulo con `hasModule()`

### Datos sensibles

- Passwords siempre hasheados con bcrypt (mínimo 12 rounds) — nunca en texto plano
- Nunca devolver `passwordHash` en respuestas de API — excluirlo explícitamente en las queries
- Credenciales siempre en `.env.local` — nunca hardcodeadas en el código
- `.env.local` en `.gitignore` — nunca subir credenciales al repositorio

### Inputs y queries

- Sanitizar y validar todos los inputs antes de pasarlos a Sequelize
- Usar siempre los métodos de Sequelize (nunca SQL raw con inputs del usuario)
- Si se necesita SQL raw, usar `sequelize.escape()` obligatoriamente

### API y respuestas

- Los endpoints del portal del cliente (`/app/portal/`) completamente aislados del dashboard interno
- Nunca exponer stack traces en producción — errores genéricos hacia el cliente, detalle solo en logs
- CORS configurado explícitamente — nunca `origin: *` en producción
- HTTPS obligatorio en producción

### Auditoría

- Registrar en `AuditLog` todos los cambios de configuración de tenant
- Registrar accesos fallidos repetidos
- Los logs de auditoría nunca se borran ni modifican (`updatedAt: false` en el modelo)

---

### Personalización visual por tenant

Cada tenant puede tener su propia identidad visual dentro del CRM.
Los valores se guardan en el campo `settings` (JSONB) del modelo `Tenant`.

**Estructura en `tenant.settings.brand`:**

```json
{
  "brand": {
    "primaryColor": "#FF5C2B",
    "secondaryColor": "#1A0A00",
    "logoUrl": "https://..."
  }
}
```

**Implementación en el frontend:**
Los colores se inyectan como variables CSS en el layout del dashboard.
Todos los componentes usan `var(--color-primary)` y `var(--color-secondary)`
en lugar de colores fijos, de modo que cada cliente ve su propia identidad visual automáticamente.

```jsx
<body style={{
  "--color-primary": tenant.settings.brand.primaryColor,
  "--color-secondary": tenant.settings.brand.secondaryColor,
}}>
```

**Decisiones tomadas:**

- Paleta de colores por tenant — color primario y secundario, suficiente para personalizar sin complicar
- Logo por tenant — imprescindible, se muestra en el sidebar y cabecera
- Fuente tipográfica — una sola fuente fija para todo el CRM (no por tenant)

**El login de Salamandra** usa la paleta Obsidiana fija (`#0F0F0F` + `#2EE59D`).
La personalización por tenant solo aplica dentro del dashboard, una vez autenticado.
