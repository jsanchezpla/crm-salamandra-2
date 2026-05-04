# Módulo de Leads / Comercial (`leads`)

> Documentación de detalle. Referencia rápida en `CLAUDE.md` (sección
> "Módulos del CRM"). Si encuentras una discrepancia con el código,
> prevalece el código: actualiza este fichero.

## Visión general

Un lead es una oportunidad comercial. El módulo cubre: alta manual desde
el dashboard, alta pública desde formularios web (sin autenticación),
import desde Excel/CSV, export a Excel, gestión de stages y notas. Es el
módulo más maduro del CRM y el que tiene **más overrides por tenant**:
seis al cierre de este documento, todos consumiendo el mismo modelo
`Lead` y los mismos endpoints, pero pintando UI radicalmente distinta.

Adicionalmente, el tenant `abarcaia` tiene activado un sub-módulo
`referidos` (también basado en `Lead`, filtrado por
`customFields.source = "referido_abarcaia"`).

## Lo que NO hace (por ahora)

Confirmado leyendo el código:

- **Conversión de lead `won` a Cliente o Proyecto**: hoy `won` solo es
  un valor de `stage`. No hay endpoint ni lógica que cree un `Client` o
  un `Project` a partir de un lead ganado.
- **Email automático al lead** al crearse o cambiar de stage. La página
  legacy `/comercial/leads` tiene un botón "Aceptar promoción" que abre
  el cliente de correo del usuario con `mailto:`, pero no hay envío
  automático desde backend.
- **Pipeline visual tipo Kanban** de stages. La UI es siempre lista o
  tabla; no hay drag-and-drop entre columnas.
- **Asignación automática a un comercial** según reglas (round-robin,
  zona, etc.). El campo `assignedTo` existe pero se setea siempre a
  mano.
- **Scoring / cualificación automática**.
- **Captcha en formularios públicos**. `/api/public/leads` y
  `/api/public/referidos` aceptan POST sin autenticación ni captcha;
  solo CORS abierto y `x-tenant` como header. Riesgo de spam.
- **Webhook a n8n** al crear o cambiar de stage. Búsqueda en `app/api/leads`
  y `modules/` no encuentra ninguna referencia a n8n ni `webhook`.
- **AuditLog**: el módulo no registra ningún evento en `master.AuditLog`.
  Crear, editar, importar masivamente o borrar (hard delete) es
  silencioso. Contrasta con `team` y `billing`, que sí auditan.
- **Soft delete**. `DELETE /api/leads/[id]` ejecuta `lead.destroy()` —
  borrado físico irrecuperable.

## Modelo Lead

Fichero: `models/tenant/Lead.model.js`. Tabla: `leads`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID PK | |
| `clientId` | UUID nullable | FK opcional a `Client`. Si el lead ya tiene cuenta abierta. |
| `name`, `phone`, `email`, `title` | STRING nullable | Datos de contacto. `email` valida `isEmail` en el modelo. |
| `stage` | **STRING(50)**, default `new` | **No es ENUM.** Cualquier string cabe en BD. La whitelist vive en endpoints (ver "Stages"). |
| `probability` | INTEGER 0-100 nullable | Probabilidad estimada de cierre. Sin uso en la UI actual. |
| `value` | DECIMAL(12,2) nullable | Valor estimado de la oportunidad. Sin uso en la UI actual. |
| `expectedCloseDate` | DATEONLY nullable | Sin uso en la UI actual. |
| `assignedTo` | UUID nullable | UUID libre. **No hay asociación Sequelize con `TeamMember`** y no se valida que el UUID exista en la tabla. |
| `notes` | TEXT nullable | Notas internas. |
| `tipo_usuario` | ENUM `ciudadano` / `profesional` nullable | **Legacy del dominio Aumenta** (terapéutico). Solo usado por aumenta y demo. |
| `motivo` | ENUM `diagnostico` / `servicios` / `cursos` / `talleres` nullable | Idem legacy Aumenta. |
| `servicio`, `curso`, `taller` | STRING nullable | Idem legacy Aumenta. Se rellena solo el que coincida con `motivo`. |
| `mensaje` | TEXT nullable | Mensaje del formulario web. Idem legacy Aumenta. |
| `customFields` | JSONB, default `{}` | Bolsa de extensión. Cada tenant guarda claves distintas; ver "Módulo base vs overrides". |
| `source` | STRING nullable | Origen del lead (`csv_import`, `excel_import`, etc.). |
| `metadata` | JSONB, default `{}` | Para Retorika almacena `{ promo: "pack-ia" }`. |

Asociación (en `lib/db/tenantDb.js`):

- `Client.hasMany(Lead, { foreignKey: "clientId", as: "leads" })` y la
  inversa `Lead.belongsTo(Client, { as: "client" })`.

No existe asociación `Lead → TeamMember`: aunque `assignedTo` es un
UUID, no hay `belongsTo` en el código. Si más adelante se quiere
filtrar leads por comercial, hay que añadir la asociación y validar
existencia al setear el campo.

## Stages

`Lead.stage` es `STRING(50)` sin restricción a nivel de schema. La
whitelist canónica vive en **`lib/leads/stages.js`** (`ALLOWED_STAGES`
y `STAGE_LABELS`) y se consume desde todos los endpoints que la
necesitan: `PATCH /api/leads/[id]`, `POST /api/leads/import`,
`POST /api/leads/import/excel` y `GET /api/leads/export`.

Los 12 stages aceptados:

- **Estándar**: `new`, `contacted`, `qualified`, `proposal`,
  `negotiation`, `won`, `lost`.
- **Extendidos** (overrides quality-energy y abarcaia):
  `in_progress`, `demo_scheduled`, `demo_done`, `closed_yes`,
  `closed_no`.

Antes del fix, `PATCH` solo permitía los 7 estándar y descartaba
silenciosamente los 5 extendidos, lo que rompía el cambio de stage
desde la UI de QE y abarcaia. Ahora cualquier endpoint los acepta y
las etiquetas humanas vienen del mismo `STAGE_LABELS`. Ver
"Incoherencias resueltas".

## Módulo base vs overrides

### Arquitectura de personalización

El frontend del módulo se monta en `app/(dashboard)/leads/page.jsx`.
Lee `x-tenant` del request, busca un override en un mapa
**hardcodeado** y, si no encuentra, cae al base:

```jsx
const UI_OVERRIDES = {
  quality_energy: QECLeadsModule,
  retorika: RetorikaLeadsModule,
  aumenta: AumentaLeadsModule,
  abarcaia: AbarcaIALeadsModule,
  demo: DemoLeadsModule,
  spain_enzymes: SpainEnzymesLeadsModule,
};
```

`TenantModule.uiOverride` (campo registrado por los seeds) **no se
consulta**: existe la columna en BD, los seeds escriben valores tipo
`"quality-energy/LeadsModule"`, pero ningún componente la lee. Es
infraestructura preparada para resolución dinámica que de momento se
sustituye con `import` + `switch` en código. Ver "Incoherencias".

Todos los overrides siguen el mismo patrón funcional (estado en React,
panel lateral de detalle, debounced search, fetch a `/api/leads`); lo
que cambia es:

- La **lista de stages** que muestran (y por tanto cuántos botones
  aparecen).
- Las **claves de `customFields`** que pintan en la tabla y en el
  panel.
- Las **columnas** y filtros adicionales.
- La **paleta** y el branding visual.
- La presencia de **import CSV inline** y **operaciones bulk**.

### Tabla resumen de overrides

| Slug | Líneas | Stages que muestra | `customFields` que lee | Particularidades |
| --- | ---: | --- | --- | --- |
| (base) | 80 | 7 estándar | ninguno | Tabla mínima sin filtros, sin edición, sin panel. Fallback. |
| `aumenta` | 568 | `new`, `contacted`, `lost` | (ninguno extra; usa `motivo`/`servicio`/`curso`/`taller`/`mensaje` del modelo) | Filtro por `motivo`. Brand rosa `#FF1F96`. |
| `demo` | 579 | `new`, `contacted`, `lost` | (ninguno extra; igual a aumenta) | Clon casi literal de `aumenta` sin brand. |
| `retorika` | 568 | `new`, `contacted`, `qualified`, `won`, `lost` | `mensaje` (con fallback al campo del modelo) | Sin import inline ni bulk. |
| `spain-enzymes` | 1025 | `new`, `contacted`, `qualified`, `won`, `lost` | `empresa`, `pais`, `ciudad`, `asunto`, `prioridad` | CSV import inline, bulk ops, conversión a Cliente parcial (`company`, `country`, `city`, `topic`). Drawer en portal. |
| `quality-energy` | 1744 | `new`, `contacted`, **`in_progress`**, **`demo_scheduled`**, **`demo_done`**, **`closed_yes`**, **`closed_no`** | `cargo`, `empresa_actual`, `zona`/`zone`, `linkedin`, `utmSource`, `utmMedium`, `utmCampaign` | Excluye en cliente los leads `referido_abarcaia`. Cargos `Autónomo`/`Trabajador por cuenta ajena`. CSV import. Bulk ops. **PATCH de stage falla silencioso** (ver bug). |
| `abarcaia` | 1965 | mismos 7 que QE | `cargo`, `empresa_actual`, `zona`/`zone`, `linkedin`, `instagram_user`, `prioridad`, `respuesta`, `demo_agendada`, `fecha_demo`, `utmSource`, `utmMedium`, `utmCampaign` | Excluye en cliente los leads `referido_abarcaia`. `fecha_demo` con fecha+hora separadas. Cálculo automático de prioridad por proximidad de la demo. Link a Instagram. CSV import. Bulk ops. **Mismo bug de PATCH**. |

### Módulo base — `modules/leads/LeadsModule.jsx`

80 líneas. Tabla simple con cuatro columnas (Nombre/Título, Email,
Teléfono, Estado). Stages: los 7 estándar con `STAGE_LABELS`. Fetch a
`/api/leads` sin filtros. Sin edición, sin panel, sin import. Sirve
únicamente como fallback si el slug del tenant no está en
`UI_OVERRIDES`. Hoy ningún tenant lo usa porque los seis tenants
activos tienen entrada en el mapa.

### Override `aumenta` — `modules/overrides/aumenta/LeadsModule.jsx`

Sector: psicología y terapia infantil. Brand rosa
(`PRIMARY = "#FF1F96"`, `SECONDARY = "#563FA6"`).

Stages reducidos a 3 (`new`, `contacted`, `lost`). El override usa los
campos legacy del modelo (`tipo_usuario`, `motivo`, `servicio`,
`curso`, `taller`, `mensaje`) que se rellenan desde el formulario web
público. Un helper `getDetalle(lead)` decide qué texto mostrar según
`motivo`. Filtro adicional `?motivo=` que viaja al backend (lo soporta
`GET /api/leads`).

### Override `demo` — `modules/overrides/demo/LeadsModule.jsx`

Tenant interno de pruebas. **Es prácticamente una copia del override
`aumenta`** (mismos stages, mismo `MOTIVO_LABEL`, mismo
`getDetalle`, misma estructura), sin la paleta rosa. Útil para
demostraciones a clientes interesados en el caso de uso "centro de
formación".

### Override `retorika` — `modules/overrides/retorika/LeadsModule.jsx`

Sector: formación en comunicación (mentoring, branding político,
comunicación y liderazgo educativo).

Stages estándar reducidos a 5 (sin `proposal` ni `negotiation`).
Lee `mensaje` desde `customFields.mensaje` o desde la columna `mensaje`
del modelo (fallback). No tiene import inline ni operaciones bulk.

### Override `spain-enzymes` — `modules/overrides/spain-enzymes/LeadsModule.jsx`

Sector: productos enzimáticos industriales.

Stages estándar reducidos a 5. `customFields` específicos:
`empresa`, `pais`, `ciudad`, `asunto`, `prioridad` (`alta`/`media`/`baja`).
CSV import inline (parser propio en el cliente, mapping de cabeceras
multilenguaje). Bulk ops: cambiar stage o borrar varios leads de una
vez. Soporte de **conversión parcial** a `Client`: cuando se acepta
un lead, copia `empresa→company`, `pais→country`, `ciudad→city`,
`asunto→topic` al crear el cliente (la lógica se llama desde el
override pero el endpoint de Clients es el responsable final). Drawer
en portal con `createPortal`.

### Override `quality-energy` — `modules/overrides/quality-energy/LeadsModule.jsx`

Sector: energética (asesores comerciales).

Stages **no estándar** de 7 valores: `new`, `contacted`, `in_progress`,
`demo_scheduled`, `demo_done`, `closed_yes`, `closed_no`. Cargos:
`Autónomo` / `Trabajador por cuenta ajena`. Lee
`customFields.cargo`, `empresa_actual`, `zona`/`zone`, `linkedin` y los
parámetros UTM. Excluye en cliente los leads marcados como
`source: "referido_abarcaia"` (vestigio de cuando el módulo `referidos`
vivía en este tenant; ver "Migraciones por tenant").

CSV import inline, bulk ops. **El cambio de stage desde la UI no
funciona** para los stages no estándar — el backend los descarta
silenciosamente (ver "Incoherencias").

### Override `abarcaia` — `modules/overrides/abarcaia/LeadsModule.jsx`

El override más grande (1.965 líneas). Sector: captación de
comerciales / partners para AbarcaIA.

Mismos 7 stages no estándar que QE. `customFields` superset:
`cargo`, `empresa_actual`, `zona`/`zone`, `linkedin`,
`instagram_user`, `prioridad`, `respuesta`, `demo_agendada`,
`fecha_demo`, más `utmSource`/`utmMedium`/`utmCampaign`. Editor
separado de fecha y hora para `fecha_demo`. La prioridad se calcula
sola desde la cercanía de la demo (`calculatePriority`: `< 3 días`
→ alta, `≤ 6 días` → media, en otro caso baja). Link directo al
perfil de Instagram. CSV import + bulk ops. Mismo bug de PATCH de
stage que QE.

También excluye los leads `referido_abarcaia` del listado principal
(esos los gestiona el sub-módulo Referidos, ver siguiente sección).

### Sub-módulo Referidos (solo `abarcaia`)

Fichero: `modules/overrides/quality-energy/ReferidosModule.jsx`
(sí, está en la carpeta de quality-energy por razones históricas).

El componente exportado se llama `AbarcaIAReferidosModule` y consume
`/api/referidos`, que devuelve solo leads con
`customFields.source = "referido_abarcaia"`. El formulario web público
correspondiente vive en `/api/public/referidos` y guarda los leads con
ese `source` y un `codigo_referido` opcional (UPPERCASE) en
`customFields`.

Stages mostrados: 5 estándar (`new`, `contacted`, `qualified`, `won`,
`lost`). `customFields` específicos: `codigo_referido`, `fecha_envio`.
`PATCH /api/referidos/[id]` solo permite cambiar `stage` y `notes` (el
endpoint es muy restrictivo).

El `moduleAccess` del usuario admin de abarcaia incluye `["leads", "referidos"]`
(ver `scripts/seed-abarcaia.js`). El admin del tenant
quality-energy **ya no** tiene `referidos` activado: el script
`scripts/remove-abarcaia-from-quality.js` lo limpió en su día (ver
"Migraciones por tenant").

## Frontend — rutas

| Ruta | Estado | Función |
| --- | --- | --- |
| `/leads` | activa | Lista de leads. Server component que selecciona el override según `x-tenant`. Es la única ruta enlazada desde el sidebar. |
| `/comercial/leads` | **huérfana** | Página legacy hardcodeada para Retorika (promociones "pack-ia" y "formacion-presencial" con botón "Aceptar promoción" → `mailto:`). No la enlaza ningún componente. Candidata a borrar. |
| `/referidos` | activa (solo abarcaia) | Lista de referidos de AbarcaIA. Importa `AbarcaIAReferidosModule` directamente, sin selección por tenant. |

## Endpoints

Las mutaciones del módulo `leads` requieren rol **admin/superadmin**
(igualado al patrón de `team` y `billing`). Antes era abierto a
cualquier autenticado del tenant; el fix bloqueó POST/PATCH/DELETE/
import a admin-only. `GET` y `export` siguen disponibles para
cualquier autenticado del tenant.

### Privados (autenticación JWT vía middleware)

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/leads` | Listado con filtros `stage`, `search`, `empresa`, `motivo`, `promo`, `limit` (max 200), `offset`. Devuelve `{ leads, total }`. | `hasModule("leads")` o `hasModule("sales")`. |
| `POST /api/leads` | Crear lead. Acepta tanto `mensaje` como `message` (alias). Mete `promo` en `metadata`. | Solo admin/superadmin. |
| `GET /api/leads/[id]` | Detalle. | `hasModule(...)`. |
| `PATCH /api/leads/[id]` | Actualiza campos whitelisted. Acepta los 12 stages (`ALLOWED_STAGES`). Hace merge de `customFields`. | Solo admin/superadmin. |
| `DELETE /api/leads/[id]` | **Hard delete** (`destroy()`). Sin auditoría. | Solo admin/superadmin. |
| `GET /api/leads/export` | Descarga Excel. Plantilla por tenant: `spain_enzymes` y `abarcaia` tienen layout propio; resto cae a `DEFAULT_CONFIG`. | `hasModule(...)`. |
| `POST /api/leads/import` | Importación masiva JSON. Max 1.000. Acepta los 12 stages. Sin transacción global: errores se acumulan en `results.errors` por fila. | Solo admin/superadmin. |
| `POST /api/leads/import/excel` | Importación masiva desde `.xlsx`. Mapping de cabeceras multilenguaje (`HEADER_MAP`). Mismo límite y mismas reglas que el JSON. | Solo admin/superadmin. |
| `GET /api/leads/import/template` | Descarga plantilla `.xlsx` con cabeceras + ejemplo + helpers. Layout por tenant (`spain_enzymes`, `abarcaia`, default). | `hasModule(...)`. |
| `GET /api/referidos` | Lista de leads filtrados por `customFields.source = "referido_abarcaia"`. | `hasModule(...)`. |
| `PATCH /api/referidos/[id]` | Solo permite cambiar `stage` y `notes`. Verifica que el lead sea efectivamente un referido antes de aplicar. | Solo admin/superadmin. |

### Públicos sin autenticación

| Método y ruta | Propósito |
| --- | --- |
| `OPTIONS /api/public/leads` y `POST /api/public/leads` | Crear lead desde formulario web. CORS abierto (`Access-Control-Allow-Origin: *`). Tenant resuelto por header `x-tenant`. Acepta múltiples convenciones: `nombre`+`apellidos` o `name`, `telefono` o `phone`. Funde `empresa` en `customFields`. |
| `OPTIONS /api/public/referidos` y `POST /api/public/referidos` | Crear referido. Hardcodea `customFields.source = "referido_abarcaia"` y normaliza `codigo_referido` a uppercase. Mismas convenciones de naming. |

Mismas reglas en ambos: rechazan si el body no trae nombre ni email
(`fullName || email`); validan que el módulo (`leads` o `sales`) esté
activo; si el tenant no se resuelve devuelven `404 "Tenant no
encontrado"`.

#### Riesgos y protecciones de los endpoints públicos

- **No hay rate limiting**. Un atacante puede crear leads arbitrarios
  contra cualquier tenant cuyo slug conozca.
- **CORS `*`**: cualquier origen puede llamarlos. Aceptable para
  formularios públicos, pero implica que un script malicioso en
  cualquier web puede enviar leads.
- **No hay captcha** ni protección de spam.
- **Tenant resolver desde header**: el cliente decide el `x-tenant`.
  Si conoces los slugs (no son secretos: aparecen en URLs públicas),
  puedes elegir destino. Un atacante puede inundar a un tenant con
  basura.
- Sanitización mínima: `.trim()` y `.toLowerCase()` en email. No hay
  validación de longitud máxima por campo, ni filtrado de payloads
  HTML/JS para prevenir inyección si los datos se renderizan después.

Pendiente en backlog: rate limiting, captcha o token compartido entre
formulario web y CRM.

## Filtros y búsqueda

`GET /api/leads` acepta:

- `stage`: filtro exacto sobre `stage`.
- `motivo`: filtro exacto sobre la columna `motivo`.
- `empresa`: usa `customFields @> '{"empresa": ...}'` (JSONB contains).
- `promo`: usa `metadata @> '{"promo": ...}'` (JSONB contains).
- `search`: `iLike` sobre `name`, `email`, `phone`, `title`.
- `limit` (cap 200), `offset`.
- Orden fijo: `createdAt DESC`. No hay `sortBy` whitelisted como en
  billing/team.

`GET /api/leads/export` acepta `stage`, `empresa`, `search` y replica
los filtros antes de generar el Excel.

`GET /api/referidos` acepta solo `stage`, `search`, `limit`, `offset`
y siempre añade el filtro `customFields @> '{"source": "referido_abarcaia"}'`.

## Validaciones

- `POST /api/leads`: requiere **`name` o `title`** (al menos uno).
  Email se normaliza a minúsculas; si llega `""` se guarda `null`. No
  se comprueba unicidad del email — **se permiten duplicados**.
- `POST /api/public/leads` y `/api/public/referidos`: requieren
  **`name` o `email`**. Mismo comportamiento de normalización.
- `PATCH /api/leads/[id]`: whitelist explícita (`name`, `phone`,
  `email`, `title`, `stage`, `probability`, `value`,
  `expectedCloseDate`, `assignedTo`, `notes`, `customFields`,
  `tipo_usuario`, `motivo`, `servicio`, `curso`, `taller`, `mensaje`).
  Cualquier otra clave se ignora. `stage` no estándar se descarta
  silenciosamente. `customFields` se mergea con el existente, no se
  sobrescribe.
- `POST /api/leads/import` y `/excel`: rechaza filas sin `name` ni
  `email` ni `phone` (las cuenta como `skipped`). Convierte el `stage`
  legible (ej. "Demo agendada") al canónico (`demo_scheduled`) usando
  `STAGE_MAP`. Errores por fila no interrumpen el resto.
- No hay validación de transición entre stages: cualquier salto está
  permitido.

## Importación / Exportación

### Plantilla de import (`GET /api/leads/import/template`)

Plantilla por tenant. Tres ficheros distintos:

- `spain_enzymes`: 10 columnas (Nombre, Empresa, Email, Teléfono,
  País, Ciudad, Asunto, Mensaje, Estado, Prioridad).
- `abarcaia`: 14 columnas (Nombre, Email, Teléfono, Cargo,
  Empresa actual, Ubicación, LinkedIn, Usuario Instagram, Estado,
  Respuesta, Demo Agendada, Fecha Demo, Prioridad, Notas).
- Default: 6 columnas (Nombre, Email, Teléfono, Empresa, Estado,
  Notas).

Cada plantilla incluye una fila de ejemplo y otra de helpers (texto
en gris) explicando el formato esperado de cada campo.

### Import (`POST /api/leads/import` y `/excel`)

- **Formato JSON** (`/import`): `{ leads: [...] }` con max 1.000.
- **Formato Excel** (`/import/excel`): multipart/form-data con `file`.
  Headers se normalizan vía `HEADER_MAP` (acepta `nombre`,
  `name`, `candidato` → `name`; `correo`, `e-mail` → `email`; etc.)
- Stages legibles se mapean a canónicos (`STAGE_MAP`):
  `"Nuevo"` → `new`, `"Demo agendada"` → `demo_scheduled`, etc.
- Duplicados: **no se detectan**. Una fila idéntica a un lead existente
  se inserta como nuevo registro.
- Resultado: `{ imported, skipped, errors[] }`. `skipped` cuenta filas
  sin name/email/phone; `errors` recoge fallos por fila con número de
  fila Excel (1-indexed +1 por la cabecera).

### Export (`GET /api/leads/export`)

Genera un único Excel con una hoja "Leads". Cabeceras en verde
(`#1B3A2D`), filas alternas con fondo gris claro. Nombre de fichero
`leads_AAAA-MM-DD.xlsx`. Stages se traducen al label castellano
mediante `STAGE_LABELS` (incluye los 12 stages, los 7 estándar y los
5 no estándar de QE/abarcaia).

## Integraciones con otros módulos

- **Auth**: la mayoría de endpoints requieren JWT vía middleware. Los
  tres endpoints de `/api/public/*` lo evitan explícitamente (CORS).
- **Equipo (#6)**: campo `assignedTo` (UUID) sin asociación Sequelize
  ni validación. Si en el futuro se quiere "leads del comercial X",
  hay que añadir `Lead.belongsTo(TeamMember, ...)` y validar
  existencia al setear.
- **Clientes (#1)**: `Lead.clientId` permite vincular un lead a un
  cliente existente. La conversión "lead ganado → cliente nuevo" no
  está automatizada; spain-enzymes hace una conversión parcial desde
  el frontend (copiando algunos `customFields` al body del POST de
  Clients), pero el resto de tenants no.
- **Audit (master.AuditLog)**: el módulo **no audita** ningún evento.
  Cualquier acción es silenciosa.
- **n8n**: sin integración. El `metadata` JSONB y el campo `source`
  pueden alimentar webhooks futuros pero hoy no hay nada conectado.
- **Próximos**: Proyectos (#3) — un lead ganado debería poder
  convertirse en `Project`. Hoy no existe ese flujo.

## Migración y seeds por tenant

### Seeds de tenant

Cada tenant tiene su propio seed que crea schema, fila en
`master.tenants`, usuario admin y registra el módulo `leads` (con
`uiOverride` aunque no se use). Tabla resumen:

| Slug en `master.tenants` | Seed | uiOverride registrado | moduleAccess admin | Leads creados |
| --- | --- | --- | --- | ---: |
| `retorika` | `seed-master.js` + `seed-retorika.js` | (no registra leads) | `["training", "clients"]` | 0 (solo curso) |
| `aumenta` | `seed-aumenta.js` | `aumenta/LeadsModule` | `["leads"]` | ~40 |
| `quality_energy` | `seed-quality-energy.js` | `quality-energy/LeadsModule` | `["leads"]` | ~40 (stages estándar; el override pinta otros) |
| `abarcaia` | `seed-abarcaia.js` | `abarcaia/LeadsModule` | `["leads", "referidos"]` | 0 (datos vienen de import o público) |
| `demo` | `seed-demo.js` + `add-leads-module-demo.js` | `demo/LeadsModule` | `["clients", "leads", ...]` | 35 |
| `spain_enzymes` | `seed-spain-enzymes.js` (+ `seed-spain-enzymes-data.js`) | `spain-enzymes/LeadsModule` | `["leads"]` | variable |

Los slugs en `master.tenants` que llevan más de una palabra usan
**underscore**, no guión: `quality_energy`, `spain_enzymes`. CLAUDE.md
los lista con guión en algunas partes (ver "Incoherencias detectadas"
y revisar antes de iterar sobre slugs).

### Scripts de mantenimiento

Histórico de scripts ad-hoc que aún viven en `scripts/` por si hace
falta repetir:

| Script | Para qué sirvió | Estado |
| --- | --- | --- |
| `cleanup-bad-leads.js` | Borra leads de `crm_quality_energy` con `email IS NULL AND phone IS NULL AND source = 'csv_import'` (basura del import). | Útil, idempotente, hardcodea slug `quality_energy` y password local. |
| `migrate-quality-leads.js` | Añade `source` y `metadata` a `crm_quality_energy.leads` (esas columnas no existían antes en el modelo). | Histórico, ya no debería ser necesario; el modelo actual ya las define. Hardcodea credenciales locales. |
| `clear-aumenta-leads.js`, `clear-quality-leads.js`, `clear-abarcaia-leads.js` | `TRUNCATE` de `leads` por tenant para resembrar de cero. | Útil cuando se quieren reseed desde formulario público. |
| `remove-abarcaia-from-quality.js` | Limpió leads y referidos de AbarcaIA que vivían en `crm_quality_energy` y desactivó el módulo `referidos` en QE. | Histórico (one-shot). Dejó AbarcaIA como tenant separado con su propio CRM. Explica por qué `ReferidosModule.jsx` vive en `modules/overrides/quality-energy/` aunque solo lo use abarcaia. |

No existe un script de migración multi-tenant tipo
`migrate-leads-fields.js` (al estilo de `migrate-team-fields.js` o
`migrate-billing-rework.js`). Los cambios al modelo `Lead` se han ido
haciendo con `sequelize.sync({ alter: true })` durante los seeds, por
eso aparecen scripts ad-hoc para tenants concretos cuando hace falta
algo más fino.

## Backlog

Detectado durante la documentación (en orden vagamente sugerido):

- **Conversión de lead `won` a `Client` o `Project`** (cuando exista
  módulo Proyectos). spain-enzymes hace una conversión parcial; el
  resto no.
- **Pipeline visual tipo Kanban** de stages (drag-and-drop entre
  columnas).
- **Email automático** al crear o cambiar stage (hoy solo `mailto:`
  manual desde la UI legacy).
- **Asignación automática a comercial** según reglas (round-robin,
  zona, UTM).
- **Scoring / cualificación automática** (probability poblada
  automáticamente desde valor, fecha esperada, comportamiento).
- **Captcha y rate limiting** en `/api/public/leads` y
  `/api/public/referidos`.
- **AuditLog** para acciones del módulo (mínimo: import masivo, hard
  delete, cambios de stage).
- **Soft delete** o al menos confirmación + auditoría en DELETE.
- **Webhook a n8n** al crear lead o cambiar stage (especialmente
  útil para alertas de stage `won` o `closed_yes`).
- **Asociación Sequelize `Lead.belongsTo(TeamMember, ...)`** para
  filtrar y validar `assignedTo`.
- **Borrar la ruta huérfana `app/(dashboard)/comercial/leads/page.jsx`**.
- **Eliminar el override `demo`** o convertirlo en un alias de
  `aumenta` (es prácticamente idéntico).
- **Mover `ReferidosModule.jsx`** de
  `modules/overrides/quality-energy/` a
  `modules/overrides/abarcaia/` para que coincida con el tenant que
  realmente lo usa.
- **Validación de unicidad de email** al crear lead (al menos como
  warning), o detección de duplicados al importar.

## Incoherencias resueltas en este sprint

Cinco de las nueve incoherencias detectadas durante la documentación
inicial se arreglaron en el mini-sprint posterior. Las cuatro
restantes están listadas como tareas concretas en "Backlog".

### 1. PATCH ya acepta los 12 stages (era BUG funcional)

Antes, `app/api/leads/[id]/route.js:5` definía
`ALLOWED_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]`
y descartaba silenciosamente los 5 stages adicionales que usan los
overrides de `quality-energy` y `abarcaia`
(`in_progress`, `demo_scheduled`, `demo_done`, `closed_yes`,
`closed_no`). El frontend hacía PATCH y recibía `200 OK` pero el
cambio no persistía. Los comerciales movían leads entre stages
y al recargar perdían el cambio.

Solución: nueva fuente única en `lib/leads/stages.js` con la lista
canónica de 12 stages y un `STAGE_LABELS` compartido. Los endpoints
`[id]/route.js`, `import/route.js`, `import/excel/route.js` y
`export/route.js` consumen desde ahí, eliminando las constantes
locales duplicadas.

`Lead.stage` sigue siendo `STRING(50)` en BD (no ENUM); no fue
necesaria migración SQL.

### 2. Guard de admin en mutaciones de `/api/leads*`

Antes, `POST`, `PATCH`, `DELETE` y los dos endpoints de import no
validaban `x-user-role`: cualquier usuario autenticado del tenant
podía crear, editar e incluso borrar leads (hard delete). Ahora,
todos requieren admin/superadmin con respuesta `403` y mensaje
"Solo administradores pueden modificar/importar leads". Mismo
patrón en `PATCH /api/referidos/[id]`.

`GET` y `GET /api/leads/export` siguen abiertos a cualquier
autenticado del tenant — los comerciales necesitan listar y
exportar.

### 3. CLAUDE.md actualizado con la asignación real de módulos

La tabla de tenants en `CLAUDE.md` decía que `quality-energy` tenía
módulo `referidos` y `abarcaia` solo `leads`. La realidad (verificada
contra `master.tenants` y `master.tenant_modules` el 2026-04-30) es
al revés: `abarcaia` tiene `leads` y `referidos`, y `quality_energy`
solo `leads` (después de que `remove-abarcaia-from-quality.js`
desactivara `referidos` en QE en su día).

La tabla actualizada lista los 6 tenants con su asignación real, los
slugs tal cual están en BD (con underscore), y notas relevantes (la
historia del cleanup de QE, por ejemplo).

### 4. Convención de slugs documentada (era cosmético)

`master.tenants.slug` y los schemas PostgreSQL usan underscore
(`quality_energy`, `spain_enzymes`); las carpetas en
`modules/overrides/` usan guión (`quality-energy/`,
`spain-enzymes/`). Razón: el regex de validación en
`lib/db/tenantDb.js` es `/^[a-z0-9_]+$/`.

Investigación: el frontend (`app/(dashboard)/leads/page.jsx`) hace un
mapping hardcodeado por slug y usa underscore (coincide con BD). Las
carpetas con guión solo se referencian via `import` estático en ese
mismo fichero — no hay comparación literal entre slug y nombre de
carpeta en runtime. Por lo tanto la inconsistencia es **cosmética**
y no rompe nada.

Solución: documentar la convención explícitamente en `CLAUDE.md`
(tabla de tenants) y en este fichero. No se refactoriza nada
(renombrar schemas sería migración mayor; mover carpetas no aporta).

### 5. `cleanup-bad-leads.js` y `migrate-quality-leads.js` ya leen `DATABASE_URL`

Antes hardcodeaban la cadena de conexión local
(`postgresql://postgres:portero_1@localhost:5432/salamandra`). Ahora
leen `process.env.DATABASE_URL` y validan su presencia (fallan
limpio si no está). Tienen cabecera de comentario indicando que son
scripts históricos conservados por si hace falta repetirlos, con
ejemplos de uso local y producción.

Auditoría adicional: no hay otros scripts con `DATABASE_URL`
hardcodeada. Sí aparecen 4 scripts con la contraseña de seed
`Admin1234!` (`db-sync.js`, `reset-demo-password.js`,
`seed-demo.js`, `seed-master.js`) — son passwords de cuenta admin
del demo que se hashean con bcrypt antes de guardar; están marcadas
como "temporal — cambiar en producción". No es vulnerabilidad de
configuración, pero conviene revisarlas en un sprint general de
seeds.

## Backlog (incoherencias no resueltas en este sprint)

Documentadas como tareas concretas para iteraciones futuras:

- **Decidir el destino de `TenantModule.uiOverride`**. Hoy los seeds
  escriben valores tipo `"quality-energy/LeadsModule"` pero ningún
  componente lo lee — la resolución de override está hardcodeada en
  `app/(dashboard)/leads/page.jsx`. Opciones: (a) implementar
  `getUiOverride()` en `getTenantContext` y resolver dinámicamente,
  (b) borrar la columna y los strings que la rellenan. Mientras
  tanto, añadir un nuevo tenant con override sigue exigiendo editar
  el page.jsx.

- **Mover `ReferidosModule.jsx`** de `modules/overrides/quality-energy/`
  a `modules/overrides/abarcaia/` para que coincida con el tenant que
  realmente lo usa. Actualizar imports en
  `app/(dashboard)/referidos/page.jsx` y borrar el comentario obsoleto
  ("Solo quality-energy usa este módulo").

- **Re-seed o re-diseño de stages en `quality_energy`**. El seed
  siembra leads con stages estándar (`qualified`, `won`) que el
  override no muestra como filtros (usa `in_progress`,
  `demo_scheduled`, `demo_done`, `closed_yes`, `closed_no`). UX
  inconsistente: un usuario filtra por "Demo agendada" y solo ve los
  leads importados, no los seedeados. Decisión de negocio.

- **Borrar la ruta huérfana `/comercial/leads`** (248 líneas legacy
  hardcoded para Retorika con promociones "pack-ia" y
  "formacion-presencial"). No está enlazada desde el `Sidebar` ni
  desde ningún otro lado del repo. Reemplazada por `/leads` con
  override desde hace tiempo.

- **Soft delete o auditoría en DELETE**. Hoy `DELETE /api/leads/[id]`
  ejecuta `lead.destroy()` sin huella. Mínimo: registrar en
  `master.AuditLog`. Mejor: soft delete con flag o paranoid mode de
  Sequelize.

- **Captcha y rate limiting** en `/api/public/leads` y
  `/api/public/referidos` (ya estaba en el backlog general).

- **Asociación Sequelize `Lead.belongsTo(TeamMember)`** para validar
  `assignedTo` y permitir filtros por comercial.

- **Conversión de lead `won` a `Client` o `Project`** automática.

- **Eliminar el override `demo`** o convertirlo en alias de `aumenta`
  (es prácticamente idéntico).
