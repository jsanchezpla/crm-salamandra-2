# Módulo Outreach (Captación)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `outreach` · requiere — (nada obligatorio en `lib/provisioning/catalogo.js`; solo avisa de que necesita las claves de IA y de Google del propio cliente). «Convertir en cliente» pide además `clients` (`tenantHasModule` en el endpoint). |
| **Reina** | — · ninguna declarada en doc ni código. Nació del proyecto interno «Salamandra Outreach» y sus pruebas apuntan al tenant `sandbox` de local. |
| **Pantallas** | `app/(dashboard)/outreach/` (3, envoltorios de una línea sobre `modules/outreach/`): `/outreach` (lista, filtros, «Buscar nuevos», alta manual), `/outreach/[id]` (ficha: contactos, análisis por línea de negocio, correo modelo, convertir en cliente), `/outreach/configuracion` (líneas de negocio y ajustes de IA). Entrada de menú «Captación» en `components/layout/Sidebar.jsx`. |
| **Endpoints** | `app/api/outreach/**` (11 `route.js`): `leads` (listar/alta manual), `leads/[id]` (ficha/editar/borrar), `leads/buscar-nuevos` (⚡ **Google Places** con la clave del tenant + visita de webs; Páginas Amarillas/LinkedIn vía webhook n8n), `leads/[id]/analizar` (⚡ **Claude**: scoring por línea + correo modelo), `leads/[id]/enviar-correo` (✉ **Resend** con la clave del tenant; marca `sent_at` solo si de verdad sale), `leads/[id]/convertir-cliente`, `leads/bulk-delete`, `google-usage`, `business-lines` + `business-lines/[id]`, `settings`. Los tres marcados pasan por `assertNotDemoPaidCall` (`lib/demo/isDemo.js`). Todos exigen `hasModule("outreach")`; líneas, ajustes y borrados, rol admin. |
| **Lógica** | `lib/outreach/` (11): `analysis/index.js` (`analyzeLead`: Claude o el simulado), `analysis/anthropic.js` (proveedor Claude; lo reutiliza medio CRM: Clínica, Proyectos, Soporte, Citas, Calendario, asistente), `analysis/fake.js` (`OUTREACH_FAKE_AI=1`, nunca en producción), `analysis/prompt.js` (system prompt desde las líneas de negocio del tenant), `analysis/schema.js` (parseo defensivo del JSON), `analysis/models.js` (modelos admitidos; reexporta `lib/ai/anthropicModel.js`); `googlePlaces.js` (Text Search; errores → `QUOTA`/`BAD_KEY`/`UNREACHABLE`), `enrichWebsite.js` (email de la web con filtro por dominio), `persistLeads.js` (dedupe por nombre+ubicación+fuente), `scraping.js` (webhook HMAC a n8n para PA/LinkedIn), `resendConfig.js` (clave de Resend del tenant, cifrada; remitente y reply-to del tenant o del `.env`). Fuera: `lib/ai/anthropicKey.js` (BYOK, sin clave → 503) y `lib/email/resendClient.js` (envío, dry-run y reintentos). |
| **UI** | `modules/outreach/` (8): `OutreachModule.jsx` (lista, orden, filtros, drawer «Buscar nuevos»), `OutreachLeadDetail.jsx` (ficha, chips de líneas a analizar, `EmailDraft`), `OutreachSettingsModule.jsx` (líneas de negocio + modelo/contexto/regla), `SectorPicker.jsx` + `sectores.json` (27 categorías, 286 tipos), `IntegrationGate.jsx` + `useIntegrations.js` (deshabilita lo que cuesta API si falta la clave; fail-open), `scores.js` (tramos y colores del score). Sin `components/outreach/`. |
| **Modelos** | `OutreachLead` → `outreach_leads` · `OutreachContact` → `outreach_contacts` · `OutreachAnalysis` → `outreach_analyses` · `OutreachBusinessLine` → `outreach_business_lines` · `OutreachSettings` → `outreach_settings` (fila única: modelo IA, contexto, regla, contador mensual de Google). **`OutreachLead` no es `Lead`** (`leads`): sin FK entre ellos; `outreach_leads.client_id` es referencia blanda al `Client` convertido. |
| **Interruptores y parámetros** | `featureFlags` / `logicOverrides`: ninguno que lea el código. Lo configurable vive en `outreach_settings` (modelo, contexto, regla) y en `master.tenants.settings.integrations` (claves de Anthropic, Google Places y Resend, remitente y reply-to), que se pegan en `/configuracion`. |
| **Pantallas propias** | ninguna. |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> outreach` (`ensure-tenant-schema.js` corre las 4 del bloque `outreach` de `scripts/_module-migrations.js`: `migrate-outreach-sprint-1`, `migrate-outreach-google-usage`, `migrate-outreach-convert`, `migrate-outreach-website-text`). Los atajos anteriores siguen vivos: `_hechos/enable-outreach.js` (`npm run db:enable:outreach`) y `_hechos/setup-outreach.js` (`npm run db:setup:outreach`: activa + migra + siembra de una vez). Seed: `seed-outreach.js <slug>` (líneas de negocio + leads de muestra con análisis `model: 'demo'`; lo lanzan `crear-demos-por-oficio.js` para `demo_agencia` y `rebuild-demo-showcase.js`). `_hechos/setup-demo-outreach-fake.js` deja la demo con claves ficticias para enseñar el flujo sin gastar. Sin backfills. |
| **Pruebas** | `scripts/_smoke-outreach-ai-unit.mjs` — pura (prompt, parseo, `analyzeLead` con el simulado; sin base de datos ni servidor): **entra en `npm test`** desde el 19/08/2026 (antes se llamaba `_outreach-ai-unit.mjs` y `pruebas.mjs`, que solo recoge `_smoke-*` y `smoke-test-*`, no la veía). Las otras tres siguen fuera **a propósito**: `_outreach-smoke.mjs`, `_outreach-e2e.mjs` y `_outreach-ui-check.mjs` piden servidor + base de datos y firman el JWT de `admin@sandbox.local` para el tenant `sandbox`, que no existe ni en local ni en producción; se lanzan a mano, y antes habría que apuntarlas a un tenant que exista. |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` |
| **En este doc** | Decisiones de arquitectura · Fuente de datos: Google Maps nativo + email de la web · Dedupe de "Buscar nuevos" (`lib/outreach/persistLeads.js`) · Conversión a cliente · Modelo de datos · API · Reglas de negocio que no se rompen · Puesta en marcha en un tenant |

`moduleKey`: `outreach` · Ruta: `/outreach` · API: `/api/outreach/*`

Captación de leads en frío: empresas rastreadas de fuentes públicas, guardadas,
y puntuadas por IA según lo bien que encajan como cliente de cada **línea de
negocio** del tenant. Del lead se puede sacar el correo modelo (IA), enviarlo
con Resend y, si prospera, convertirlo en cliente del módulo Clientes.

Origen: proyecto standalone `Salamandra Outreach`, integrado y muy ampliado en
el CRM.

---

## Estado

| Área | Estado |
| ---- | ------ |
| Modelo de datos, API, UI (lista, ficha, configuración) | **Hecho** |
| Análisis con IA (Claude): scoring + correo modelo | **Hecho** |
| Envío del correo modelo con Resend | **Hecho** |
| "Buscar nuevos" con **Google Maps NATIVO** (Places API + email de la web) | **Hecho** |
| Tope mensual de Google + aviso + contador (gestionado por el CRM) | **Hecho** |
| Convertir lead en cliente + borrado individual y en bulk | **Hecho** |
| Orden por columnas y filtros (ubicación, email, analizado, score) | **Hecho** |
| "Buscar nuevos" con Páginas Amarillas / LinkedIn (vía n8n) | **Pendiente** (flujo n8n sin montar) |

**En producción** (foto de `master` del 19/08/2026) en cinco tenants:
`aumenta`, `demo` (11 leads), `demo_agencia` (11), `salamandra_solutions` (40:
somos nosotros, captando) y `somos`. Lo que cada uno puede hacer depende de las
claves que haya pegado en `/configuracion` (Anthropic, Google Places, Resend).

> **Histórico (hasta 08/2026):** «Todo verificado en local contra el tenant
> `sandbox`. Falta desplegar en producción (correr las migraciones) y que cada
> tenant pegue sus claves.» `sandbox` no existe hoy ni en local ni en
> producción; solo sobrevive en las tres pruebas con servidor (ver Mapa →
> Pruebas).

> Las claves de IA (**Anthropic** y **Google Places**) ya **no** son secrets
> globales del `.env`: se configuran **por tenant** en el módulo
> **Configuración** (`/configuracion` → Inteligencia Artificial). Ver
> `docs/modules/configuracion.md`.

---

## Decisiones de arquitectura

### 1. Es un producto multi-tenant, no una herramienta interna

El Outreach original puntuaba cada empresa contra dos compañías fijas, cableadas
en código y prompt. En el CRM eso es la tabla **`outreach_business_lines`**:
cada tenant define sus líneas, con descripción y criterios de scoring. De ahí se
construye el system prompt del análisis. **Los criterios son datos, no código.**
Se editan en `/outreach/configuracion`.

Consecuencia en la UI: la ficha de un lead no tiene dos mitades fijas, sino
**una columna por línea de negocio activa**.

### 2. Independiente del módulo Leads del CRM

El `Lead` comercial del CRM (oportunidad con etapas, valor y conversión a
proyecto) es otra cosa. El lead de Outreach es **una empresa captada aún sin
contactar**. Entidades separadas, **sin FK cruzadas**; de ahí el prefijo
`outreach_` en las tablas (si no, `outreach_leads` chocaría con `leads`).

### 3. Solo Claude como proveedor de IA

Se usa **solo la API de Claude**. El selector de modelo se mantiene entre
modelos de Claude (Opus/Sonnet/Haiku) para abaratar el coste por análisis sin
tocar código.

### 4. El correo se envía con Resend, no con n8n

Se envía **directamente** con `lib/email/resendClient.js` (dry-run + reintentos),
para no duplicar las credenciales de Resend en n8n.

### 5. Google Maps es NATIVO en el CRM; n8n queda para las demás fuentes

`"Buscar nuevos"` con **Google Maps** no pasa por n8n: el CRM llama a la
**Google Places API (Text Search)** con la clave del tenant y, por cada negocio,
visita su web para sacar el email. **Páginas Amarillas** y **LinkedIn** siguen
delegándose a n8n (aún sin montar). Motivo: con las claves ya por-tenant en el
CRM, no hay que pasar secretos a n8n para Google, y el flujo es más simple.

### 6. Claves de IA por tenant (BYOK)

Cada tenant trae su propia clave de Anthropic y de Google Places (self-service
en Configuración). **Ninguna tiene fallback de entorno**: son per-tenant
obligatorias. La de Anthropic **ya no lee `ANTHROPIC_API_KEY`** (se resuelve con
`lib/ai/anthropicKey.js`); sin ella, el análisis responde `503`. Las claves viven en `master.tenants.settings.integrations`
y **nunca** se serializan al cliente (el layout las elimina).

---

## Fuente de datos: Google Maps nativo + email de la web

El flujo de `"Buscar nuevos"` con Google Maps es:

```
Google Places (índice)  →  visitar la web de cada negocio  →  extraer email  →  guardar
```

### Paso 1 — índice (`lib/outreach/googlePlaces.js`)

`Text Search` de la Places API (New) con la clave del tenant. `FieldMask`:
`displayName, formattedAddress, nationalPhoneNumber, websiteUri, googleMapsUri,
primaryTypeDisplayName`. `regionCode: ES`, `pageSize: 20` (hasta 20 negocios por
petición). Traduce los errores de Google a códigos: `QUOTA` (429, cuota
agotada), `BAD_KEY` (400/403, clave inválida o Places API sin activar),
`UNREACHABLE` (timeout/red). Google **nunca** devuelve email.

### Paso 2 — email de la web (`lib/outreach/enrichWebsite.js`)

Visita la home del negocio (y, si no hay email, una vez `/contacto`) y extrae el
correo. Qué se tiene en cuenta:

1. Descarga el HTML (sigue redirecciones, timeout 7s, User-Agent de navegador).
2. Busca emails: primero `mailto:` (más fiable), luego barrido de texto.
3. Filtra basura (imágenes, trackers `sentry`/`wixpress`, placeholders).
4. **Filtra por dominio** (clave): solo acepta emails **del propio dominio del
   negocio** o de un **proveedor gratuito** (Gmail, Hotmail, Outlook…). Cualquier
   otro dominio ajeno (temas/plugins/trackers, p.ej. `quadlayers.com`) **se
   descarta** — antes se colaban como plan B.
5. Preferencia: genérico del dominio (`info@`, `contacto@`…) → cualquiera del
   dominio → genérico gratuito → cualquiera gratuito → **`null`**.

Cobertura realista ~40–70%; si no hay email válido se guarda **sin email** (mejor
eso que un correo erróneo). Tecnología: `fetch` nativo + `AbortController` +
regex + API `URL`; sin navegador headless, sin proxy, sin librería. En
`buscar-nuevos` las webs se visitan con un **pool de concurrencia** de 5.

### Tope mensual de Google (gestionado por el CRM, no por Google)

Contador por tenant en `outreach_settings` (`google_places_usage_month`,
`google_places_usage_count`, `google_places_warned_month`):

- Cada búsqueda con Google = **1 petición** = +1 (una búsqueda trae hasta ~20
  negocios; se cuentan **búsquedas**, como factura Google, no negocios).
- **Corta a 999/mes** (uno por debajo del cupo gratuito de 1.000 de Google): al
  llegar, `buscar-nuevos` responde `429` sin llamar a Google.
- **Aviso por email** una vez al mes al cruzar el umbral (best-effort vía Resend,
  al `x-user-email` del que busca).
- **Se reinicia solo** al cambiar de mes (sin cron: si el contador es de un mes
  anterior, cuenta como 0).
- `GET /api/outreach/google-usage` devuelve `{ month, count, limit, remaining }`
  para pintar "te quedan N búsquedas" en el drawer.

> Con este tope propio, **no hace falta** tocar la cuota diaria de Google. El
> límite real lo pone el CRM.

---

## Dedupe de "Buscar nuevos" (`lib/outreach/persistLeads.js`)

Por cada empresa, dedupe por `(name, location, source)`:

| Situación | Qué pasa |
| --------- | -------- |
| Ya es **cliente** (convertido) | Intacto — no se re-capta (`keptClient`) |
| Ya existe y **está analizado** | Intacto — no se repite ni se pisa su análisis (`keptAnalyzed`) |
| Ya existe y **NO** analizado | Se **borra el viejo y se re-inserta fresco** → datos al día y sube arriba (`refreshed`) |
| No existe | Se inserta (`inserted`) |

La lista ordena por `created_at DESC`, por eso el refrescado sube arriba. La
función está extraída del route para poder testearla aislada.

---

## Conversión a cliente

`POST /api/outreach/leads/:id/convertir-cliente` crea un `Client` (módulo
Clientes) a partir del lead y **marca el lead como convertido** (no lo borra):

- El `Client` se crea con `type: company`, `email` (solo si es válido), `phone`,
  y `customFields` con `origin: "outreach"`, `website`, `sector`, `city`,
  `sourceUrl`, `outreachLeadId`.
- El lead se marca `converted = true`, `converted_at`, `client_id`.
- Efecto: **desaparece de la lista de captados** (la lista filtra
  `converted = false`) y **`"Buscar nuevos"` no lo vuelve a insertar** (el dedupe
  lo salta como `keptClient`).
- Requiere que el tenant tenga el módulo `clients` activo (`tenantHasModule`).

---

## Modelo de datos

Cinco tablas en el schema del tenant (`crm_{slug}`), todas con PK `UUID`:

| Tabla | Qué guarda |
| ----- | ---------- |
| `outreach_business_lines` | Líneas de negocio del tenant y sus criterios de scoring |
| `outreach_leads` | Empresas captadas, aún sin contactar |
| `outreach_contacts` | Personas dentro de cada empresa (`is_decision_maker`) |
| `outreach_analyses` | Análisis IA: uno por lead × línea de negocio |
| `outreach_settings` | Fila única: modelo IA, contexto, regla, y contador mensual de Google |

**Columnas añadidas después del sprint 1:**

- `outreach_settings`: `google_places_usage_month` (VARCHAR 7 "YYYY-MM"),
  `google_places_usage_count` (INT), `google_places_warned_month` (VARCHAR 7).
- `outreach_leads`: `converted` (BOOL), `converted_at` (TIMESTAMPTZ),
  `client_id` (UUID, referencia blanda al `Client`, sin FK).

**Claves e integridad:**

- `outreach_leads` único `(name, location, source)` → base del dedupe.
- `outreach_analyses` único `(outreach_lead_id, business_line_id)` → un análisis
  por lead y línea; se persiste para no reanalizar salvo petición.
- Borrar un lead arrastra contactos y análisis (`ON DELETE CASCADE`).
- `score` con `CHECK (score BETWEEN 0 AND 100)` en BD.
- `outreach_business_lines.key` es **inmutable**.

Modelos: `models/tenant/Outreach*.model.js`, registrados en `lib/db/tenantDb.js`.

---

## Escala de score

| Tramo | Significado | Color |
| ----- | ----------- | ----- |
| 80–100 | Encaje muy alto — prioridad de llamada | verde relleno |
| 60–79 | Buen encaje — merece contacto | verde claro |
| 40–59 | Encaje medio — segunda ronda | ámbar |
| 0–39 | Encaje bajo — descartar de momento | gris |
| `null` | Sin analizar | blanco con borde |

El dorado de marca **nunca** se usa en badges de score (reservado a CTA/acentos).

---

## API

Todos los endpoints van en `withTenant` y comprueban `hasModule("outreach")`.
Las mutaciones de líneas/ajustes y los borrados exigen rol `admin`.

| Método | Ruta | Qué hace |
| ------ | ---- | -------- |
| `GET` | `/api/outreach/leads` | Lista. **Solo lee de BD.** Excluye convertidos |
| `POST` | `/api/outreach/leads` | Alta manual de un lead |
| `POST` | `/api/outreach/leads/buscar-nuevos` | Google Maps **nativo** (Places + email de la web); PA/LinkedIn vía n8n |
| `POST` | `/api/outreach/leads/bulk-delete` | Borrar varios leads (admin) — body `{ ids: [...] }` |
| `GET` | `/api/outreach/google-usage` | Uso de Google del mes `{ month, count, limit, remaining }` |
| `GET` | `/api/outreach/leads/:id` | Ficha: contactos + análisis + líneas activas |
| `PATCH` | `/api/outreach/leads/:id` | Editar campos del lead |
| `DELETE` | `/api/outreach/leads/:id` | Borrar (admin) |
| `POST` | `/api/outreach/leads/:id/analizar` | Analiza con IA. Upsert de un análisis por línea. Body opcional `{ lineIds: [uuid…] }` para analizar solo un subconjunto (sin él → todas las activas) |
| `POST` | `/api/outreach/leads/:id/enviar-correo` | Envía el correo modelo (Resend) y marca `sent_at` |
| `POST` | `/api/outreach/leads/:id/convertir-cliente` | Crea `Client` y marca el lead convertido |
| `GET` / `POST` | `/api/outreach/business-lines` | Listar / crear línea (POST admin) |
| `PATCH` / `DELETE` | `/api/outreach/business-lines/:id` | Editar / borrar línea (admin) |
| `GET` / `PATCH` | `/api/outreach/settings` | Ajustes IA (modelo/contexto/regla) — PATCH admin |

**Filtros de `GET /leads`:** `q`, `sector`, `location`, `source`, `analyzed`
(true/false), `hasEmail` (true/false), `minScore` + `line`, `sort`
(`name|sector|location|source|analyzed|email|createdAt`) + `dir` (`asc|desc`),
`limit`, `offset`.

### Selección de líneas por lead (ficha)

`analizar` acepta un `lineIds` opcional. La ficha (`OutreachLeadDetail.jsx`)
muestra, cuando hay más de una línea, unos chips **"Líneas a analizar:"** (todas
seleccionadas por defecto) para elegir qué líneas analizar en **esa** empresa; se
pasan como `lineIds`. El backend filtra a `{ active: true, id: lineIds }` y hace
**upsert solo de esas líneas** — los análisis de las líneas no seleccionadas se
**conservan** intactos. Sin `lineIds` (o array vacío) → todas las líneas activas.

### Selector de sector en "Buscar nuevos"

El sector del drawer usa `modules/outreach/SectorPicker.jsx`: un **acordeón por
categoría** (los "sectores"), con los **tipos de empresa** dentro en nombre plano
(p. ej. "Clínica dental", no "Salud y bienestar · Clínica dental"). Todos los
grupos empiezan **plegados**; un buscador filtra por **nombre de categoría O de
tipo**. El valor elegido es el **string del tipo tal cual**, que
`buscar-nuevos` usa como `textQuery` libre de Google (no se valida contra una
lista). El catálogo vive en `modules/outreach/sectores.json` (27 categorías, ~286
tipos; algún tipo aparece en dos categorías a propósito). Los `<Select>` planos
del filtro superior y del alta manual siguen usando una lista aplanada y
**deduplicada por valor**.

**Degradación sin claves:** el análisis usa la clave Anthropic del tenant
(Configuración → IA); **sin ella `/analizar` responde `503`** (no hay fallback de
entorno).
`"Buscar nuevos"` con Google sin clave del tenant responde `400` con un mensaje
que apunta a Configuración → IA. PA/LinkedIn sin `OUTREACH_SCRAPING_WEBHOOK_URL`
responden `503`.

**Bloqueo en la UI (además del backend):** el módulo se puede **abrir** sin
claves, pero las acciones que cuestan API quedan **deshabilitadas** según qué
clave falte, con un aviso ámbar y enlace a `/configuracion`:

| Acción | Clave requerida | Dónde |
| ------ | --------------- | ----- |
| Buscar nuevos (Google Maps) | Google Places | botón cabecera + submit del drawer (`OutreachModule.jsx`) |
| Analizar / Re-analizar | Anthropic | botón de la ficha (`OutreachLeadDetail.jsx`) |
| Enviar correo | Resend | botón por línea de negocio (`EmailDraft`) |

El estado se lee con el hook `modules/outreach/useIntegrations.js`
(`GET /api/tenant/settings` → `integrations.{anthropic,googlePlaces,resend}.configured`,
auth y **no** admin-only) y el aviso lo pinta `modules/outreach/IntegrationGate.jsx`.
Es **optimista mientras carga** (no parpadea el caso configurado) y **fail-open**
si el fetch de estado falla: el backend sigue siendo la barrera real (400/503).
Las acciones que **no** consumen API (alta manual, editar, eliminar, convertir en
cliente, filtros) nunca se bloquean.

### Contrato del webhook de scraping (solo PA / LinkedIn, vía n8n)

`POST $OUTREACH_SCRAPING_WEBHOOK_URL` con
`{ "sector", "location", "sources": ["paginas_amarillas"|"linkedin"] }` y
cabecera `x-outreach-signature: <hmac-sha256-hex del cuerpo>` firmada con
`OUTREACH_WEBHOOK_SECRET`. n8n responde con un array de empresas (o un objeto que
lo envuelva: `empresas`/`companies`/`results`); alias ES/EN por campo; lo no
mapeado va a `raw_data`. **Google Maps ya no pasa por aquí.**

---

## Reglas de negocio que no se rompen

1. **Nunca scrapear ni reanalizar por defecto.** Leer de BD es lo normal; scrape
   y análisis cuestan y solo ocurren si el usuario lo pide.
2. **La IA propone, una persona confirma.** El correo modelo nunca se envía solo;
   `sent_at` solo tras confirmación explícita.
3. **El análisis se persiste** para no reanalizar.
4. **Mejor sin email que con un email erróneo** (filtro de dominio).
5. **Convertir/analizado no se re-capta**; el no-analizado se refresca.

---

## Puesta en marcha en un tenant

Un solo comando desde el 01/08/2026 — abre las DOS puertas (la fila en
`master.tenant_modules` y el `module_access` de los admin; usuarios normales
con `--grant-users`) y corre las **cuatro** migraciones del bloque `outreach`
de `scripts/_module-migrations.js` (`migrate-outreach-sprint-1`,
`-google-usage`, `-convert`, `-website-text`), idempotentes:

```powershell
# Local
node --env-file=.env.local scripts/enable-module.js <slug> outreach

# (Opcional) Datos de muestra: líneas de negocio + leads con análisis `model: 'demo'`
node --env-file=.env.local scripts/seed-outreach.js <slug>
```

```bash
# Producción: dentro del contenedor (las vars vienen del entorno Docker)
docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> outreach
```

Y `npm run db:check-access` para comprobar que los usuarios lo ven.

Los atajos anteriores siguen vivos y hacen lo mismo por partes:
`npm run db:enable:outreach -- <slug>` (solo la fila), `npm run
db:migrate:outreach` + `:usage` + `:convert` + `:website` (las cuatro
migraciones, una a una), `npm run db:seed:outreach -- <slug>`, y
`_hechos/setup-outreach.js` (`npm run db:setup:outreach`: activa + migra + siembra de
una vez). En producción, nunca `:prod` con `--env-file`: `docker exec`.

Después: cada tenant pega su clave de **Anthropic**, de **Google Places** y de
**Resend** en `/configuracion` → Inteligencia Artificial. Sin ellas el módulo se
abre, pero las acciones que cuestan API quedan deshabilitadas (ver «Bloqueo en
la UI»).

> **Postgres 12 (local):** la migración base usa `gen_random_uuid()` (nativa
> desde PG13); en local la aporta `pgcrypto`, y si no, omite el `DEFAULT`
> (Sequelize genera el UUID en JS). Producción es PG16.

---

## Variables de entorno

| Variable | Ámbito | Para qué |
| -------- | ------ | -------- |
| **Clave Anthropic** | Por tenant (Configuración) | Analizar con IA. **Sin fallback de entorno** (`lib/ai/anthropicKey.js`) |
| **Clave Google Places** | Por tenant (Configuración) | `"Buscar nuevos"` Google Maps. **Sin fallback de entorno** |
| `OUTREACH_SCRAPING_WEBHOOK_URL` | Entorno | Webhook n8n para PA/LinkedIn |
| `OUTREACH_WEBHOOK_SECRET` | Entorno | Firma HMAC del cuerpo enviado a n8n |
| **Clave Resend** | Por tenant (Configuración) | Enviar el correo modelo. **Cifrada, sin fallback** (`lib/outreach/resendConfig.js`) |
| `OUTREACH_FROM_EMAIL` | Entorno (default) | Remitente por defecto; el tenant puede sobrescribirlo en Configuración |
| `OUTREACH_REPLY_TO` | Entorno (default) | Reply-to por defecto; el tenant puede sobrescribirlo en Configuración |
| `OUTREACH_RESEND_API_KEY` | — | **YA NO se usa**: la clave de Resend es por-tenant |
| `OUTREACH_FAKE_AI` | Entorno | `=1` activa el analizador simulado (solo fuera de producción) |

Los secrets de entorno se ponen en `.env.local` y en el `.env.production` del VPS
por SSH. **Nunca por chat** (regla #15 de CLAUDE.md). Las claves de IA por-tenant las pega el
propio cliente en la UI (BYOK) —o se las ponemos nosotros desde el back-office,
`lib/provisioning/credencialesCliente.js`— y se guardan en BD cifradas
(enmascaradas en la API, nunca al cliente).

---

## Modo simulado (desarrollo)

`OUTREACH_FAKE_AI=1` sustituye Claude por un analizador determinista con contenido
`[SIMULADO]`; los análisis se guardan con `model = "fake"`. Ignorado en
`NODE_ENV=production`.

Para el correo no hay variable de entorno que valga: la clave de Resend es la
del tenant (`lib/outreach/resendConfig.js`, **sin fallback** a
`RESEND_API_KEY`), y sin ella `enviar-correo` responde **400** antes de
intentar nada. Para probar sin mandar nada al exterior se guarda en
Configuración la clave literal `dry-run`: `sendEmail` entonces solo loguea y el
endpoint devuelve `dryRun: true` sin marcar `sent_at`. (`_hechos/setup-demo-outreach-fake.js`
deja así la demo.)

> **Histórico:** «Sin `RESEND_API_KEY` el envío es dry-run» — era verdad cuando
> la clave era global del `.env`.

---

## Pendiente

- **Flujo de n8n para Páginas Amarillas / LinkedIn** (Google ya es nativo).
- Verificar el dominio del remitente en Resend antes de enviar correo real.
- Análisis en lote (hoy es lead a lead desde la ficha).
- (Opcional) contador de Google también visible fuera del drawer.
