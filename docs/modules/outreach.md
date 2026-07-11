# Módulo Outreach (Captación)

`moduleKey`: `outreach` · Ruta: `/outreach` · API: `/api/outreach/*`

Captación de leads en frío: empresas rastreadas de fuentes públicas, guardadas,
y puntuadas por IA según lo bien que encajan como cliente de cada **línea de
negocio** del tenant.

Origen: proyecto standalone `Salamandra Outreach`, integrado en el CRM.

---

## Estado

| Fase | Alcance | Estado |
| ---- | ------- | ------ |
| 1 | Modelo de datos, API, UI (lista, ficha, configuración) | **Hecho** |
| 2 | Análisis con IA (Claude): scoring + correo modelo | **Hecho** |
| 3 | Scraping vía n8n + envío del correo con Resend | **Hecho** |

Todo verificado en local contra el tenant `sandbox`. **Falta desplegar en
producción** y provisionar los secrets (ver "Puesta en marcha").

En la Fase 1 los botones **"Buscar nuevos"** y **"Re-analizar"** se muestran
deshabilitados: existen para que el flujo se entienda, pero no hacen nada
todavía. La única vía de entrada de leads es el alta manual.

---

## Decisiones de arquitectura

Tres decisiones tomadas con Jorge antes de escribir código:

### 1. Es un producto multi-tenant, no una herramienta interna

El Outreach original puntuaba cada empresa contra dos compañías fijas
(`empresa ∈ {'solutions','agencia'}`), cableadas en el código y en el prompt.
En el CRM eso pasa a ser la tabla **`outreach_business_lines`**: cada tenant
define sus propias líneas, con su descripción y sus criterios de scoring.

De ahí se construye el system prompt del análisis. **Los criterios son datos,
no código.** Se editan desde `/outreach/configuracion`.

Consecuencia en la UI: la ficha de un lead no tiene dos mitades fijas, sino
**una columna por línea de negocio activa**.

### 2. Independiente del módulo Leads del CRM

El CRM ya tiene un `Lead` (oportunidad comercial con etapas, valor y conversión
a proyecto). El lead de Outreach es otra cosa: **una empresa captada que aún no
ha sido contactada**.

Son entidades separadas, **sin puente de conversión** y sin FK cruzadas. De ahí
el prefijo `outreach_` en todas las tablas: sin él, `outreach_leads` chocaría
con la tabla `leads` que ya existe en cada schema de tenant.

### 3. Solo Claude como proveedor de IA

El Outreach original era agnóstico de proveedor (Claude + OpenAI). En el CRM se
usa **solo la API de Claude**. El selector de modelo se mantiene, pero entre
modelos de Claude, para poder abaratar el coste por análisis sin tocar código.

> El `CLAUDE.md` del CRM decía "IA: API OpenAI", pero **no había ninguna llamada
> a un LLM en el código**. Outreach es la primera integración de IA real.

### 4. El correo se envía con Resend, no con n8n

En el Outreach original el envío del correo pasaba por un webhook de n8n, que a
su vez llamaba a Resend. En el CRM se envía **directamente** con
`lib/email/resendClient.js`, que ya existe y trae dry-run y reintentos.

Motivo: evitar dos fuentes de verdad para las credenciales de Resend (una en el
`.env` del CRM y otra dentro de n8n) y un punto de fallo operativo de más. n8n
se queda para el scraping, que sí necesita un motor externo.

---

## Modo simulado (desarrollo)

`OUTREACH_FAKE_AI=1` sustituye la llamada a Claude por un analizador determinista
que devuelve contenido marcado `[SIMULADO]`. Sirve para recorrer todo el flujo
(análisis → correo → envío) sin gastar API ni tener la clave.

- Los análisis que produce se guardan con `model = "fake"`, para que nadie los
  confunda con un análisis real.
- Está **ignorado cuando `NODE_ENV=production`**: la IA real no se puede
  desactivar en el VPS con una env var.

Igualmente, sin `RESEND_API_KEY` el envío entra en dry-run: devuelve
`dryRun: true` y **no** marca `sent_at`. Marcar un correo como enviado sin
haberlo enviado sería mentirle al comercial.

---

## Modelo de datos

Cinco tablas en el schema del tenant (`crm_{slug}`), todas con PK `UUID`:

| Tabla | Qué guarda |
| ----- | ---------- |
| `outreach_business_lines` | Líneas de negocio del tenant y sus criterios de scoring |
| `outreach_leads` | Empresas captadas, aún sin contactar |
| `outreach_contacts` | Personas dentro de cada empresa (`is_decision_maker`) |
| `outreach_analyses` | Análisis IA: uno por lead × línea de negocio |
| `outreach_settings` | Fila única: modelo de IA, contexto de empresa, regla de encadenamiento |

**Claves e integridad:**

- `outreach_leads` tiene un índice único `(name, location, source)`. Es lo que
  impide que "Buscar nuevos" duplique empresas al re-scrapear la misma zona.
- `outreach_analyses` tiene único `(outreach_lead_id, business_line_id)`: un
  análisis por lead y línea. Se persiste para **no reanalizar** salvo petición
  explícita.
- Borrar un lead arrastra sus contactos y análisis (`ON DELETE CASCADE`).
- `score` lleva un `CHECK (score BETWEEN 0 AND 100)` en BD, no solo validación
  de Sequelize.
- `outreach_business_lines.key` es **inmutable**: los análisis guardados se
  identifican por ella.

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

El dorado de marca **nunca** se usa en los badges de score: está reservado a CTA
y acentos. Son colores semánticos, así que no dependen del tenant.

---

## API

Todos los endpoints van envueltos en `withTenant` y comprueban
`hasModule("outreach")`. Las mutaciones de líneas y ajustes exigen rol `admin`.

| Método | Ruta | Qué hace |
| ------ | ---- | -------- |
| `GET` | `/api/outreach/leads` | Lista ("Ver ya buscados"). **Solo lee de BD.** |
| `POST` | `/api/outreach/leads` | Alta manual de un lead |
| `GET` | `/api/outreach/leads/:id` | Ficha: contactos + análisis + líneas activas |
| `PATCH` | `/api/outreach/leads/:id` | Editar campos del lead |
| `DELETE` | `/api/outreach/leads/:id` | Borrar (admin) |
| `GET` | `/api/outreach/business-lines` | Líneas activas (`?all=true` incluye inactivas) |
| `POST` | `/api/outreach/business-lines` | Crear línea (admin) |
| `PATCH` | `/api/outreach/business-lines/:id` | Editar línea (admin) |
| `DELETE` | `/api/outreach/business-lines/:id` | Borrar línea (admin) |
| `POST` | `/api/outreach/leads/:id/analizar` | Analiza con IA. Upsert de un análisis por línea |
| `POST` | `/api/outreach/leads/:id/enviar-correo` | Envía el correo modelo (Resend) y marca `sent_at` |
| `POST` | `/api/outreach/leads/buscar-nuevos` | Dispara el scraping en n8n e inserta los leads |
| `GET` | `/api/outreach/settings` | Ajustes + modelos admitidos |
| `PATCH` | `/api/outreach/settings` | Cambiar modelo / contexto / regla (admin) |

**Degradación sin secrets:** si falta `ANTHROPIC_API_KEY`, `/analizar` responde
`503` con un mensaje claro; si falta `OUTREACH_SCRAPING_WEBHOOK_URL`,
`/buscar-nuevos` responde `503`. El resto del módulo sigue funcionando.

### Contrato del webhook de scraping

El CRM hace `POST $OUTREACH_SCRAPING_WEBHOOK_URL` con:

```json
{ "sector": "Ópticas", "location": "Salamanca", "sources": ["paginas_amarillas"] }
```

y la cabecera `x-outreach-signature: <hmac-sha256-hex del cuerpo crudo>`, firmada
con `OUTREACH_WEBHOOK_SECRET`. **El flujo de n8n debe verificarla y rechazar lo
que no cuadre** (el webhook del proyecto original iba sin autenticar).

n8n responde con un array de empresas, o un objeto que lo envuelva
(`empresas` / `companies` / `results`). Cada empresa admite alias en español o
inglés (`nombre`/`name`, `direccion`/`location`, `web`/`website`…); lo que no se
mapea se conserva en `raw_data`, que es la materia prima del análisis.

**Filtros de `GET /leads`:** `q`, `sector`, `location`, `source`, `analyzed`,
`minScore` + `line` (score mínimo en una línea concreta), `limit`, `offset`.

---

## Reglas de negocio que no se rompen

1. **Nunca scrapear ni reanalizar por defecto.** Leer de BD es el modo por
   defecto. El scraping y el análisis cuestan tiempo y dinero, y solo ocurren
   cuando el usuario lo pide explícitamente.
2. **La IA propone, una persona confirma.** El correo modelo nunca se envía
   solo; `sent_at` solo se rellena tras confirmación explícita.
3. **El análisis se persiste** para no reanalizar.

---

## Puesta en marcha en un tenant

```powershell
# 1. Activar el módulo (crea la fila en master.tenant_modules)
npm run db:enable:outreach -- <slug>

# 2. Crear las tablas en su schema (idempotente, lee la lista de master.tenants)
npm run db:migrate:outreach

# 3. (Opcional) Datos de muestra
npm run db:seed:outreach -- <slug>
```

En producción: `npm run db:migrate:outreach:prod`, o
`docker exec crm-salamandra-app-1 node scripts/migrate-outreach-sprint-1.js`.

> **Postgres 12:** la migración usa `gen_random_uuid()`, nativa desde PG13. En
> el Postgres local (12.4, el que trae Odoo) la aporta `pgcrypto`; el script la
> crea si hace falta, y si no puede, omite el `DEFAULT` (Sequelize genera el
> UUID en JS). Producción es PG16 y no necesita nada.

---

## Variables de entorno

| Variable | Obligatoria | Para qué |
| -------- | ----------- | -------- |
| `ANTHROPIC_API_KEY` | Para analizar | API de Claude |
| `OUTREACH_SCRAPING_WEBHOOK_URL` | Para "Buscar nuevos" | Webhook de scraping en n8n |
| `OUTREACH_WEBHOOK_SECRET` | Recomendada | Firma HMAC del cuerpo enviado a n8n |
| `OUTREACH_FROM_EMAIL` | No | Remitente; si falta, usa `RESEND_FROM_EMAIL` |
| `RESEND_API_KEY` | Para enviar de verdad | Sin ella, el envío es dry-run |
| `OUTREACH_FAKE_AI` | No | `=1` activa el analizador simulado (solo fuera de producción) |

Los secrets se configuran en `.env.local` y en el `.env.production` del VPS por
SSH. **Nunca por chat** (regla #14).

---

## Pendiente

- **El flujo de n8n de scraping no existe todavía.** Hay que crearlo, hacer que
  verifique la cabecera `x-outreach-signature` y devolver el array de empresas.
  Hasta entonces, "Buscar nuevos" responde 503 y el alta manual funciona.
- Verificar el dominio del remitente en Resend antes de enviar correo real.
- Programar el análisis en lote (hoy es lead a lead, desde la ficha).
