# Módulo Outreach (Captación)

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

Todo verificado en local contra el tenant `sandbox`. **Falta desplegar en
producción** (correr las migraciones) y que cada tenant pegue sus claves.

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
en Configuración). La de Anthropic cae a `ANTHROPIC_API_KEY` del entorno si el
tenant no tiene la suya; la de Google **no** tiene fallback de entorno (es
per-tenant obligatoria). Las claves viven en `master.tenants.settings.integrations`
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
| `POST` | `/api/outreach/leads/:id/analizar` | Analiza con IA. Upsert de un análisis por línea |
| `POST` | `/api/outreach/leads/:id/enviar-correo` | Envía el correo modelo (Resend) y marca `sent_at` |
| `POST` | `/api/outreach/leads/:id/convertir-cliente` | Crea `Client` y marca el lead convertido |
| `GET` / `POST` | `/api/outreach/business-lines` | Listar / crear línea (POST admin) |
| `PATCH` / `DELETE` | `/api/outreach/business-lines/:id` | Editar / borrar línea (admin) |
| `GET` / `PATCH` | `/api/outreach/settings` | Ajustes IA (modelo/contexto/regla) — PATCH admin |

**Filtros de `GET /leads`:** `q`, `sector`, `location`, `source`, `analyzed`
(true/false), `hasEmail` (true/false), `minScore` + `line`, `sort`
(`name|sector|location|source|analyzed|email|createdAt`) + `dir` (`asc|desc`),
`limit`, `offset`.

**Degradación sin claves:** el análisis usa la clave Anthropic del tenant
(fallback a `ANTHROPIC_API_KEY`); sin ninguna, `/analizar` responde `503`.
`"Buscar nuevos"` con Google sin clave del tenant responde `400` con un mensaje
que apunta a Configuración → IA. PA/LinkedIn sin `OUTREACH_SCRAPING_WEBHOOK_URL`
responden `503`.

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

```powershell
# 1. Activar el módulo
npm run db:enable:outreach -- <slug>

# 2. Crear las tablas (idempotente, lee la lista de master.tenants)
npm run db:migrate:outreach

# 3. Migraciones incrementales (contador de Google + conversión a cliente)
npm run db:migrate:outreach:usage
npm run db:migrate:outreach:convert

# 4. (Opcional) Datos de muestra
npm run db:seed:outreach -- <slug>
```

En producción, la variante `:prod` de cada una, o
`docker exec crm-salamandra-app-1 node scripts/migrate-outreach-*.js`.

Después: cada tenant pega su clave de **Anthropic** y de **Google Places** en
`/configuracion` → Inteligencia Artificial.

> **Postgres 12 (local):** la migración base usa `gen_random_uuid()` (nativa
> desde PG13); en local la aporta `pgcrypto`, y si no, omite el `DEFAULT`
> (Sequelize genera el UUID en JS). Producción es PG16.

---

## Variables de entorno

| Variable | Ámbito | Para qué |
| -------- | ------ | -------- |
| **Clave Anthropic** | Por tenant (Configuración) | Analizar con IA. Fallback a `ANTHROPIC_API_KEY` del entorno |
| **Clave Google Places** | Por tenant (Configuración) | `"Buscar nuevos"` Google Maps. **Sin fallback de entorno** |
| `OUTREACH_SCRAPING_WEBHOOK_URL` | Entorno | Webhook n8n para PA/LinkedIn |
| `OUTREACH_WEBHOOK_SECRET` | Entorno | Firma HMAC del cuerpo enviado a n8n |
| `OUTREACH_FROM_EMAIL` | Entorno | Remitente del correo modelo (si falta, `RESEND_FROM_EMAIL`) |
| `OUTREACH_REPLY_TO` | Entorno | A dónde van las respuestas del lead (buzón que sí se lee) |
| `OUTREACH_RESEND_API_KEY` | Entorno | Credencial Resend propia del outreach (si no, `RESEND_API_KEY`) |
| `OUTREACH_FAKE_AI` | Entorno | `=1` activa el analizador simulado (solo fuera de producción) |

Los secrets de entorno se ponen en `.env.local` y en el `.env.production` del VPS
por SSH. **Nunca por chat** (regla #14). Las claves de IA por-tenant las pega el
propio cliente en la UI (BYOK) y se guardan en BD (enmascaradas en la API, nunca
al cliente).

---

## Modo simulado (desarrollo)

`OUTREACH_FAKE_AI=1` sustituye Claude por un analizador determinista con contenido
`[SIMULADO]`; los análisis se guardan con `model = "fake"`. Ignorado en
`NODE_ENV=production`. Sin `RESEND_API_KEY` el envío es dry-run (`dryRun: true`,
no marca `sent_at`).

---

## Pendiente

- **Flujo de n8n para Páginas Amarillas / LinkedIn** (Google ya es nativo).
- Verificar el dominio del remitente en Resend antes de enviar correo real.
- Análisis en lote (hoy es lead a lead desde la ficha).
- (Opcional) contador de Google también visible fuera del drawer.
