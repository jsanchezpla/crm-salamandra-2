# Módulo de Leads / Comercial (`leads`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este
> mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién
> tiene el módulo NO se lista aquí** (una lista a mano se queda vieja):
> `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `leads` · requiere — (es `formularios` quien lo requiere a él; la clave `sales` se retiró el 12/08/2026) |
| **Reina** | — (ni el doc ni `lib/leads/embudos.js` nombran una; desde el 18/08/2026 el base es el override de aumenta parametrizado, y a aumenta solo le queda propio el rosa `#FF1F96`) |
| **Pantallas** | El embudo: `/leads` → `app/(dashboard)/leads/page.jsx` (server component: resuelve `UI_OVERRIDES` por `x-tenant` y le pasa al base `stages`, `titulo` y `sujeto`). El PADRE del grupo en el menú: `/leads/estadisticas` → `app/(dashboard)/leads/estadisticas/page.jsx` (mira `leads` y `formularios` juntos). Públicas: ninguna página en este repo — el formulario vive en la web del cliente y pega en el endpoint público de abajo. |
| **Endpoints** | `app/api/leads/**` — 8 `route.js`: `route.js` (GET lista, con `desglose=1` por etapa · POST), `[id]/route.js` (GET · PATCH · DELETE, los dos últimos auditados), `[id]/convert-to-project/route.js` (POST; exige además `projects`), `estadisticas/route.js` (GET), `export/route.js` (GET Excel), `import/route.js` (POST JSON), `import/excel/route.js` (POST .xlsx), `import/template/route.js` (GET plantilla). Mutaciones solo admin/superadmin. Público: `app/api/public/leads/route.js` (OPTIONS+POST; tenant por cabecera `x-tenant`, CORS `*`, límite 30/min, `sanearCustomFields`). Sin webhooks. |
| **Lógica** | `lib/leads/`: `stages.js` (las 15 etapas canónicas, `ALLOWED_STAGES` + `STAGE_LABELS`: la whitelist de PATCH, import y export), `embudos.js` (qué etapas ofrece cada cliente: `EMBUDOS` por slug de BD, `EMBUDO_POR_DEFECTO` de cinco, `GANADAS`/`PERDIDAS`, `etapasDe()`, `tieneEtapaGanada()`), `estadisticas.js` (las cifras de `/leads/estadisticas`: profesionales + comerciales, `calcularEstadisticas`). Fuera: `lib/home/summary.js` cuenta los abiertos para la portada con su propia `CLOSED_STAGES`. |
| **UI** | `modules/leads/LeadsModule.jsx` (el base, `"use client"`, 779 líneas: tarjetas por etapa, filtro por motivo, buscador, panel lateral; color de `var(--color-primary)`). La pantalla de estadísticas lleva sus piezas dentro. No hay `components/leads/`. |
| **Modelos** | `Lead` → `leads` (`models/tenant/Lead.model.js`; `stage` es STRING(50), no ENUM; `customFields` y `metadata` JSONB; `convertedProjectId`/`convertedToProjectAt`). Asociaciones en `lib/db/tenantDb.js`: `Lead.belongsTo(Client)` por `clientId` y `Lead.belongsTo(Project)` por `convertedProjectId`. Sin FK a `TeamMember` (`assignedTo` es un UUID suelto). |
| **Interruptores y parámetros** | Ninguno que lea el código (ni `featureFlags` ni `logicOverrides`). Lo que varía por cliente está escrito en código: `EMBUDOS` en `lib/leads/embudos.js`, `TENANT_TITLE_OVERRIDES` («Interesados») en la página, `TENANT_LABEL_OVERRIDES` en `components/layout/Sidebar.jsx` y las plantillas de export/import por slug (`spain_enzymes` y `nutri_laura`, en `app/api/leads/export/route.js` e `import/template/route.js`). Los `schemaExtensions` que hay en producción (nutri_laura, spain_enzymes) son letrero decorativo: el código no los lee. |
| **Pantallas propias** | 4, cargadas por el mapa `UI_OVERRIDES` de `app/(dashboard)/leads/page.jsx`: `modules/overrides/aumenta/LeadsModule.jsx`, `modules/overrides/nutri-laura/LeadsModule.jsx`, `modules/overrides/retorika/LeadsModule.jsx`, `modules/overrides/spain-enzymes/LeadsModule.jsx`. Ignoran las props del base: llevan su embudo dentro (copiado en `embudos.js`). Los de `demo` y `sandbox` se borraron el 18/08/2026; `quality-energy` y `abarcaia`, el 12/08. |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> leads`. Migraciones registradas en `scripts/_module-migrations.js`: `migrate-stage-to-string.js` (MODULES.leads) y `migrate-leads-columnas-proyecto.js` (CORE). Herramientas vivas: `listar-leads.js <slug>` (solo lectura), `mover-leads-a-comerciales.js <slug> <form> [--confirm]` (leads de familias → bandeja de Comerciales), `sincronizar-ui-override.mjs` (el letrero `ui_override`). Seeds: `add-leads-module-demo.js`, `add-leads-module-nutri-laura.js`, `seed-aumenta.js`, `seed-spain-enzymes-data.js`. Frenados: `clear-aumenta-leads.js` (exige `_guard-datos-reales.js`), `cleanup-bad-leads.js` (atado a `quality_energy`, que ya no existe). |
| **Pruebas** | `scripts/_smoke-leads-etapas.mjs` (en `npm test`; vigila que las etapas de los cuatro overrides, `embudos.js`, `stages.js` y `summary.js` no se separen) · `scripts/_smoke-ui-overrides.mjs` (en `npm test`; los mapas `UI_OVERRIDES` contra el disco) · `scripts/_smoke-lead-conversion-fix.js` (base de datos; conversión lead→cliente en nutri_laura y spain_enzymes). |
| **Decisiones** | `../decisions/2026-08-01-leads-dos-origenes-un-grupo.md` · `../decisions/2026-08-12-retirada-de-sales.md` · `../decisions/2026-08-12-bajas-abarcaia-quality-healim.md` (se llevó dos overrides) · `../decisions/2026-08-18-la-piramide-invertida-de-leads.md` |
| **En este doc** | Modelo Lead · Stages · Módulo base vs overrides · Endpoints · Validaciones · Importación / Exportación · Migración y seeds por tenant · Backlog |

> Documentación de detalle. Referencia rápida en `CLAUDE.md` (sección
> "Módulos del CRM"). Si encuentras una discrepancia con el código,
> prevalece el código: actualiza este fichero.

## Visión general

Un lead es una oportunidad comercial. El módulo cubre: alta manual desde
el dashboard, alta pública desde formularios web (sin autenticación),
import desde Excel/CSV, export a Excel, gestión de stages y notas. Es el
módulo más maduro del CRM y el que tiene **más overrides por tenant**:
cuatro hoy (`aumenta`, `nutri-laura`, `retorika`, `spain-enzymes`; llegó a
haber siete), todos consumiendo el mismo modelo `Lead` y los mismos
endpoints, pero pintando UI radicalmente distinta. Desde el 01/08/2026 es
además un GRUPO del menú con dos orígenes: este embudo («Profesionales») y
la bandeja del módulo `formularios` («Comerciales»), con `/leads/estadisticas`
como padre que mira los dos juntos.

**Histórico (hasta 12/08/2026):** el tenant `abarcaia` tenía un sub-módulo
`referidos` (también sobre `Lead`, filtrado por
`customFields.source = "referido_abarcaia"`). Se fue entero con la baja del
cliente: ni el módulo, ni `/api/referidos`, ni `/api/public/referidos`, ni la
pantalla existen hoy.

## Lo que NO hace (por ahora)

Confirmado leyendo el código:

- **Conversión de lead `won` a Cliente**: no hay endpoint ni lógica que
  cree un `Client` a partir de un lead ganado (spain-enzymes hace una
  conversión parcial desde su frontend). La conversión a **Proyecto sí
  existe**: `POST /api/leads/[id]/convert-to-project` (exige además el
  módulo `projects`; ver «Endpoints» e «Integraciones»).
- **Email automático al lead** al crearse o cambiar de stage. No hay
  envío desde backend: quien quiera avisar a un lead abre su cliente de
  correo a mano. (Hubo un botón "Aceptar promoción" con `mailto:` en la
  página legacy `/comercial/leads`, con los textos de una campaña de
  Retorika escritos a mano; la página se borró el 10/08/2026 porque no
  la enlazaba nada.)
- **Pipeline visual tipo Kanban** de stages. La UI es siempre lista o
  tabla; no hay drag-and-drop entre columnas.
- **Asignación automática a un comercial** según reglas (round-robin,
  zona, etc.). El campo `assignedTo` existe pero se setea siempre a
  mano.
- **Scoring / cualificación automática**.
- **Captcha en el formulario público**. `/api/public/leads` acepta POST
  sin autenticación ni captcha; solo CORS abierto, `x-tenant` como header
  y un límite de 30 peticiones/min por IP. Riesgo de spam.
- **Webhook a n8n** al crear o cambiar de stage. Búsqueda en `app/api/leads`
  y `modules/` no encuentra ninguna referencia a n8n ni `webhook`.
- **AuditLog completo**: se auditan `lead.updated` y `lead.deleted`
  (`PATCH`/`DELETE /api/leads/[id]`) y `project.lead_converted`
  (`convert-to-project`), con resumen de `name`, `email`, `stage`, `value`.
  Siguen siendo silenciosos el alta (`POST /api/leads`), el alta pública y
  los dos imports masivos.
- **Soft delete**. `DELETE /api/leads/[id]` ejecuta `lead.destroy()` —
  borrado físico irrecuperable (queda auditado, pero no se recupera).

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
| `convertedProjectId` | UUID nullable | FK a `Project`. Lo rellena `POST /api/leads/[id]/convert-to-project`; el frontend enseña «Ver proyecto vinculado» en vez del botón de conversión. |
| `convertedToProjectAt` | DATE nullable | Cuándo se convirtió. |

Asociaciones (en `lib/db/tenantDb.js`):

- `Client.hasMany(Lead, { foreignKey: "clientId", as: "leads" })` y la
  inversa `Lead.belongsTo(Client, { as: "client" })`.
- `Project.hasMany(Lead, { foreignKey: "convertedProjectId", as: "convertedFromLeads" })`
  y la inversa `Lead.belongsTo(Project, { as: "convertedProject" })`.

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

Los 15 stages aceptados:

- **Estándar**: `new`, `contacted`, `qualified`, `proposal`,
  `negotiation`, `won`, `lost`.
- **Extendidos** (nacieron en los overrides de quality-energy y abarcaia,
  borrados el 12/08/2026; se conservan porque `STAGE_MAP` del import los
  sigue mapeando y porque quitar una etapa de la whitelist es un cambio de
  DATO): `in_progress`, `demo_scheduled`, `demo_done`, `closed_yes`,
  `closed_no`.
- **Extendidos nutrición** (override nutri_laura):
  `consulta_agendada`, `consulta_realizada`, `paciente`.

Lo que cada cliente OFRECE en su pantalla es un subconjunto de esa lista y
se declara en `lib/leads/embudos.js` (`EMBUDOS` por slug de BD,
`EMBUDO_POR_DEFECTO` de cinco para quien no tiene override); lo vigila
`scripts/_smoke-leads-etapas.mjs`.

**Histórico:** antes del fix, `PATCH` solo permitía los 7 estándar y
descartaba silenciosamente los 5 extendidos, lo que rompía el cambio de
stage desde la UI de QE y abarcaia. Ahora cualquier endpoint los acepta y
las etiquetas humanas vienen del mismo `STAGE_LABELS`. Ver
"Incoherencias resueltas".

## Módulo base vs overrides

### Arquitectura de personalización

El frontend del módulo se monta en `app/(dashboard)/leads/page.jsx`.
Lee `x-tenant` del request, busca un override en un mapa
**hardcodeado** y, si no encuentra, cae al base:

```jsx
const UI_OVERRIDES = {
  retorika: RetorikaLeadsModule,
  aumenta: AumentaLeadsModule,
  spain_enzymes: SpainEnzymesLeadsModule,
  nutri_laura: NutriLauraLeadsModule,
};
```

(`quality_energy` y `abarcaia` se fueron con sus clientes el 12/08/2026;
`demo` y `sandbox` el 18/08/2026, ver «Módulo base» más abajo.)

`TenantModule.uiOverride` **no se consulta**: es un LETRERO que solo enseña
`/admin/modulos`, y se mantiene fiel al código con
`scripts/sincronizar-ui-override.mjs` (ver CLAUDE.md, «En Leads la pirámide
está al revés»).

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
| (base) | 779 | las que declare `lib/leads/embudos.js` (5 por defecto) | (usa `motivo`/`servicio`/`curso`/`taller`/`mensaje` del modelo) | **Es el de aumenta parametrizado** (18/08/2026): tarjetas por etapa, filtro por motivo, buscador, ofertas de empleo, panel lateral. Color de marca del tenant. Lo ven somos, gm_alvar_alonso y las cuatro demos. |
| `aumenta` | 671 | `new`, `contacted`, `lost` | (ninguno extra; usa `motivo`/`servicio`/`curso`/`taller`/`mensaje` del modelo) | Filtro por `motivo`. Brand rosa `#FF1F96`. Idéntico al base salvo el color: se conserva a propósito. |
| ~~`demo`~~ | — | — | — | **Borrado el 18/08/2026**: era una copia anterior del de aumenta sin nada propio. La demo usa el base con el embudo por defecto. |
| `retorika` | 582 | `new`, `contacted`, `qualified`, `won`, `lost` | `mensaje` (con fallback al campo del modelo) | Sin import inline ni bulk. |
| `spain-enzymes` | 1062 | `new`, `contacted`, `qualified`, `won`, `lost` | `empresa`, `pais`, `ciudad`, `asunto`, `prioridad` | CSV import inline, bulk ops, conversión a Cliente parcial (`company`, `country`, `city`, `topic`). Drawer en portal. |
| `nutri-laura` | 1877 | `new`, `contacted`, **`consulta_agendada`**, **`consulta_realizada`**, **`paciente`**, `lost` | `edad`, `motivo`, `info_adicional`, `utmSource`, `utmMedium`, `utmCampaign` | Embudo nutricional. Stages pintan transición de "lead" a "paciente activo". `motivo` e `info_adicional` son texto libre (no usan el ENUM legacy `motivo` del modelo, ver `/api/public/leads`). CSV import + bulk ops. |

(Líneas contadas el 19/08/2026.) **Histórico (hasta 12/08/2026):** había
además `quality-energy` (1.744 líneas) y `abarcaia` (1.965), con un embudo
propio de siete etapas (`new`, `contacted`, `in_progress`, `demo_scheduled`,
`demo_done`, `closed_yes`, `closed_no`), CSV import, bulk ops y, en abarcaia,
prioridad calculada por la cercanía de la demo. Se borraron con la baja de
los dos clientes (`../decisions/2026-08-12-bajas-abarcaia-quality-healim.md`).
Sus cinco etapas extendidas siguen en `ALLOWED_STAGES`, y el parámetro
`excluirOrigen` de `GET /api/leads` nació para ellos.

### Módulo base — `modules/leads/LeadsModule.jsx`

**Desde el 18/08/2026 es el override de aumenta promocionado y
parametrizado** (antes era una tabla de 94 líneas sin filtros ni panel que
veían, en producción, somos, gm_alvar_alonso y las tres demos por oficio: los
clientes más nuevos tenían la peor pantalla). Recibe de la página tres props:

- `stages` — el embudo del tenant, resuelto en el servidor con
  `etapasDe(slug)` de `lib/leads/embudos.js` (`EMBUDO_POR_DEFECTO` = las
  cinco estándar para quien no tenga override) y rotulado con `STAGE_LABELS`.
- `titulo` y `sujeto` — «Leads Profesionales» / «leads» salvo
  `TENANT_TITLE_OVERRIDES` («Interesados» en aumenta).

El color sale de `var(--color-primary)` (la marca del tenant) y
`color-mix` para los tonos, así que no lleva ningún hex de nadie. Lo que
añade sobre el override de aumenta: estilo para las 15 etapas canónicas con
gris de fallback, aviso ámbar en el panel si el lead está en una etapa que
el embudo no ofrece, bloque «Mensaje» para leads sin motivo, botón «Ofertas
de empleo» solo si hay alguna, panel bajo la barra móvil (regla 13) y el
tooltip del tope de 200. Lo vigila `scripts/_smoke-leads-etapas.mjs`.

**La demo lo usa desde el 18/08/2026** con el embudo por defecto (cinco
etapas): es el escaparate, y enseña lo que verá quien compre. Su override
—una copia anterior del de aumenta— y el de `sandbox` —la misma recoloreada,
para un tenant que no existe en ningún entorno— se borraron ese día sin
tocar un dato: los dos llamaban a los mismos tres endpoints con los mismos
cuerpos que el base.

### Override `aumenta` — `modules/overrides/aumenta/LeadsModule.jsx`

Sector: psicología y terapia infantil. Brand rosa
(`PRIMARY = "#FF1F96"`, `SECONDARY = "#563FA6"`).

Stages reducidos a 3 (`new`, `contacted`, `lost`). El override usa los
campos legacy del modelo (`tipo_usuario`, `motivo`, `servicio`,
`curso`, `taller`, `mensaje`) que se rellenan desde el formulario web
público. Un helper `getDetalle(lead)` decide qué texto mostrar según
`motivo`. Filtro adicional `?motivo=` que viaja al backend (lo soporta
`GET /api/leads`).

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

### Override `nutri-laura` — `modules/overrides/nutri-laura/LeadsModule.jsx`

Sector: nutrición y dietética (consulta privada).

Pipeline de 6 stages adaptado al embudo nutricional:
`new` → `contacted` → `consulta_agendada` → `consulta_realizada`
→ `paciente` (`lost` como salida lateral). Los tres stages
intermedios son **extendidos** y se añadieron a `lib/leads/stages.js`
para este tenant.

`customFields` específicos: `edad` (texto libre — admite valores
como "34", "menor de edad"), `motivo` (texto libre, no usa el
ENUM legacy `motivo` del modelo Lead), `info_adicional` (texto libre).
También soporta UTMs (`utmSource`, `utmMedium`, `utmCampaign`)
para tracking de origen.

CSV import inline (mapeo de cabeceras incluye "qué te gustaría
trabajar" → `motivo`, "algo más que deba saber" → `info_adicional`),
bulk ops (cambio de stage / borrado), panel lateral con preguntas
del cuestionario tal cual aparecen en el formulario web.

**Endpoint público**: `/api/public/leads` ya admite nutri_laura
sin cambios. Para evitar colisión con el ENUM `motivo` del modelo
(valores legacy `diagnostico`/`servicios`/`cursos`/`talleres`),
el endpoint detecta cuando `motivo` no es uno de los valores ENUM
y lo mueve automáticamente a `customFields.motivo`. El formulario
de Laura puede enviar:

```json
{
  "name": "Marta Gómez",
  "email": "marta@example.com",
  "telefono": "611234567",
  "customFields": {
    "edad": "34",
    "motivo": "Quiero perder unos kilos antes del verano",
    "info_adicional": "Intolerancia a la lactosa"
  }
}
```

con header `x-tenant: nutri_laura`.

### Sub-módulo Referidos — retirado

**Histórico (hasta 12/08/2026):** `abarcaia` tenía un sub-módulo `referidos`
(`ReferidosModule.jsx`, `/referidos`, `GET /api/referidos`,
`PATCH /api/referidos/[id]`, `POST /api/public/referidos`) que listaba los
leads con `customFields.source = "referido_abarcaia"`. Se retiró entero con la
baja del cliente; el Sidebar conserva un comentario que lo recuerda. Hoy no
queda ni código ni `moduleKey`.

## Frontend — rutas

| Ruta | Estado | Función |
| --- | --- | --- |
| `/leads/estadisticas` | activa | **Padre del grupo «Leads» en el sidebar** (01/08/2026): cifras de captación de un periodo (por defecto 12 meses) mirando los DOS orígenes —el embudo de Profesionales y, si el tenant tiene `formularios`, la bandeja de Comerciales—. `"use client"`, pide a `GET /api/leads/estadisticas`. |
| `/leads` | activa | El embudo («Profesionales» en el menú). Server component que selecciona el override según `x-tenant` y, si no hay, monta el base con `stages`, `titulo` y `sujeto`. |

## Endpoints

Las mutaciones del módulo `leads` requieren rol **admin/superadmin**
(igualado al patrón de `team` y `billing`). Antes era abierto a
cualquier autenticado del tenant; el fix bloqueó POST/PATCH/DELETE/
import a admin-only. `GET` y `export` siguen disponibles para
cualquier autenticado del tenant.

### Privados (autenticación JWT vía middleware)

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/leads` | Listado con filtros `stage`, `search`, `empresa`, `motivo`, `promo`, `limit` (max 200), `offset`. Con `desglose=1` añade el reparto por etapa contado en BD con el mismo `where` **sin la etapa** (y `excluirOrigen=<source>` resta los de ese `customFields.source`). Devuelve `{ leads, total, desglose, totalSinEtapa }` (los dos últimos `null` si no se pide). | `hasModule("leads")`. |
| `POST /api/leads` | Crear lead. Acepta tanto `mensaje` como `message` (alias). Mete `promo` en `metadata`. | Solo admin/superadmin. |
| `GET /api/leads/[id]` | Detalle. | `hasModule(...)`. |
| `PATCH /api/leads/[id]` | Actualiza campos whitelisted (incl. `clientId`, que se valida contra `clients` o se descarta). Acepta los 15 stages (`ALLOWED_STAGES`). Hace merge de `customFields`. Audita `lead.updated`. | Solo admin/superadmin. |
| `DELETE /api/leads/[id]` | **Hard delete** (`destroy()`). Audita `lead.deleted` con el resumen previo. | Solo admin/superadmin. |
| `POST /api/leads/[id]/convert-to-project` | Crea un `Project` (código generado, columnas Kanban por defecto, el creador como `lead` del proyecto si tiene `TeamMember`), rellena `convertedProjectId`/`convertedToProjectAt` y pasa el lead a `won` salvo que ya esté en `won`/`closed_yes`. 422 si ya estaba convertido. Audita `project.lead_converted`. | `hasModule("leads")` **y** `hasModule("projects")`. |
| `GET /api/leads/estadisticas` | Cifras de captación (`?desde=&hasta=`, por defecto 12 meses): embudo de profesionales, bandeja de comerciales (`null` sin `formularios`) y entrada por mes. Lógica en `lib/leads/estadisticas.js`. | `hasModule("leads")`; no es solo admin. |
| `GET /api/leads/export` | Descarga Excel. Plantilla por tenant: `spain_enzymes` y `nutri_laura` tienen layout propio; resto cae a `DEFAULT_CONFIG`. | `hasModule(...)`. |
| `POST /api/leads/import` | Importación masiva JSON. Max 1.000. Acepta los 15 stages. Sin transacción global: errores se acumulan en `results.errors` por fila. | Solo admin/superadmin. |
| `POST /api/leads/import/excel` | Importación masiva desde `.xlsx`. Mapping de cabeceras multilenguaje (`HEADER_MAP`). Mismo límite y mismas reglas que el JSON. | Solo admin/superadmin. |
| `GET /api/leads/import/template` | Descarga plantilla `.xlsx` con cabeceras + ejemplo + helpers. Layout por tenant (`spain_enzymes`, `nutri_laura`, default). | `hasModule(...)`. |

### Público sin autenticación

| Método y ruta | Propósito |
| --- | --- |
| `OPTIONS /api/public/leads` y `POST /api/public/leads` | Crear lead desde formulario web. CORS abierto (`Access-Control-Allow-Origin: *`). Tenant resuelto por header `x-tenant`. Acepta múltiples convenciones: `nombre`+`apellidos` o `name`, `telefono` o `phone`. Funde `empresa` en `customFields`. Al guardar avisa por la CAMPANA a los admins del tenant (`notifyAdmins`, tipo `lead_recibido`, sin el mensaje ni el motivo; 08/08/2026). |

Reglas: rechaza si el body no trae nombre ni email (`fullName || email`);
valida que el módulo `leads` esté activo (la clave `sales` se retiró el
12/08/2026); si el tenant no se resuelve devuelve `404 "Tenant no
encontrado"`.

#### Riesgos y protecciones del endpoint público

- **Rate limiting: 30 peticiones/min por IP** (`enforceRateLimit`, clave
  `public-leads`, `lib/utils/rateLimit.js`); el 429 lleva las cabeceras
  CORS para que se lea desde la landing.
- **CORS `*`**: cualquier origen puede llamarlo. Aceptable para
  formularios públicos, pero implica que un script malicioso en
  cualquier web puede enviar leads.
- **No hay captcha** ni protección de spam más allá del límite.
- **Tenant resolver desde header**: el cliente decide el `x-tenant`.
  Si conoces los slugs (no son secretos: aparecen en URLs públicas),
  puedes elegir destino dentro del límite por minuto.
- Sanitización: `.trim()` y `.toLowerCase()` en email; topes de longitud
  por campo (`name`/`title` 200, `email` 160, `phone` 40, `servicio`/
  `curso`/`taller` 200, `mensaje` 4000) y `sanearCustomFields`
  (`lib/utils/publicInput.js`, recorta `customFields` a 8 KB de JSON;
  23/07/2026). No hay filtrado de payloads HTML/JS: los datos se pintan
  como texto en React.

Pendiente en backlog: captcha o token compartido entre formulario web y
CRM.

## Filtros y búsqueda

`GET /api/leads` acepta:

- `stage`: filtro exacto sobre `stage`.
- `motivo`: filtro exacto sobre la columna `motivo`.
- `empresa`: usa `customFields @> '{"empresa": ...}'` (JSONB contains).
- `promo`: usa `metadata @> '{"promo": ...}'` (JSONB contains).
- `search`: `iLike` sobre `name`, `email`, `phone`, `title`.
- `limit` (cap 200), `offset`.
- `desglose=1`: devuelve además `desglose` (`{ etapa: n }`) y
  `totalSinEtapa`, contados en BD con los mismos filtros **menos `stage`**
  (12/08/2026: antes cada pantalla contaba con un `reduce` sobre la lista ya
  filtrada y al pulsar una etapa las demás caían a cero). Opcional
  `excluirOrigen=<source>` (`[a-z0-9_]{1,40}`): se cuenta dos veces con `@>`
  y se resta, en vez de un `NOT` que con `custom_fields` a NULL borraría
  filas en silencio.
- Orden fijo: `createdAt DESC`. No hay `sortBy` whitelisted como en
  billing/team.

`GET /api/leads/export` acepta `stage`, `empresa`, `search` y replica
los filtros antes de generar el Excel.

## Validaciones

- `POST /api/leads`: requiere **`name` o `title`** (al menos uno).
  Email se normaliza a minúsculas; si llega `""` se guarda `null`. No
  se comprueba unicidad del email — **se permiten duplicados**.
- `POST /api/public/leads`: requiere **`name` o `email`**. Mismo
  comportamiento de normalización, más los topes de longitud y el saneo
  de `customFields` de «Riesgos y protecciones».
- `PATCH /api/leads/[id]`: whitelist explícita (`name`, `phone`,
  `email`, `title`, `stage`, `probability`, `value`,
  `expectedCloseDate`, `assignedTo`, `notes`, `customFields`, `clientId`,
  `tipo_usuario`, `motivo`, `servicio`, `curso`, `taller`, `mensaje`).
  Cualquier otra clave se ignora. `stage` fuera de `ALLOWED_STAGES` se
  descarta silenciosamente. `clientId` se valida contra `clients` (`null`
  o `""` desvincula; un UUID que no exista se descarta). `customFields` se
  mergea con el existente, no se sobrescribe.
- `POST /api/leads/import` y `/excel`: rechaza filas sin `name` ni
  `email` ni `phone` (las cuenta como `skipped`). Convierte el `stage`
  legible (ej. "Demo agendada") al canónico (`demo_scheduled`) usando
  `STAGE_MAP`. Errores por fila no interrumpen el resto.
- No hay validación de transición entre stages: cualquier salto está
  permitido.

## Importación / Exportación

### Plantilla de import (`GET /api/leads/import/template`)

Plantilla por tenant (`TENANT_TEMPLATES` por slug de BD). Tres layouts:

- `spain_enzymes`: 10 columnas (Nombre, Empresa, Email, Teléfono,
  País, Ciudad, Asunto, Mensaje, Estado, Prioridad).
- `nutri_laura`: 8 columnas (Nombre, Email, Teléfono, Edad, Motivo,
  Info adicional, Estado, Notas).
- Default: 6 columnas (Nombre, Email, Teléfono, Empresa, Estado,
  Notas).

(`abarcaia` tenía la suya, 14 columnas; se fue con el cliente el 12/08/2026.)

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
mediante `STAGE_LABELS` (las 15: los 7 estándar, los 5 extendidos
heredados de QE/abarcaia y los 3 de nutrición). Columnas por tenant:
`spain_enzymes` (11, con Recibido), `nutri_laura` (9) y `DEFAULT_CONFIG`
(7, con Fecha).

## Integraciones con otros módulos

- **Auth**: la mayoría de endpoints requieren JWT vía middleware. El
  público `/api/public/leads` lo evita explícitamente (CORS + límite por
  IP).
- **Equipo (#6)**: campo `assignedTo` (UUID) sin asociación Sequelize
  ni validación. Si en el futuro se quiere "leads del comercial X",
  hay que añadir `Lead.belongsTo(TeamMember, ...)` y validar
  existencia al setear.
- **Clientes (#1)**: `Lead.clientId` permite vincular un lead a un
  cliente existente (se edita por `PATCH`, validado contra `clients`). La
  conversión "lead ganado → cliente nuevo" no está automatizada;
  spain-enzymes hace una conversión parcial desde el frontend (copiando
  algunos `customFields` al body del POST de Clients), pero el resto de
  tenants no.
- **Proyectos (#3)**: `POST /api/leads/[id]/convert-to-project` crea el
  proyecto a partir del lead (nombre, descripción desde `notes`,
  presupuesto desde `value`, `clientId` heredado), con sus columnas Kanban
  por defecto, y deja la huella en `convertedProjectId` /
  `convertedToProjectAt`. Exige `projects` activo.
- **Formularios (Leads Comerciales)**: no comparten tabla ni FK. Se
  encuentran solo en `/leads/estadisticas` (`lib/leads/estadisticas.js`
  lee `leads` y `form_submissions`) y en `scripts/mover-leads-a-comerciales.js`
  (leads de familias que entraron por el embudo → bandeja).
- **Audit (master.AuditLog)**: `lead.updated`, `lead.deleted`
  (`lib/utils/auditoria.js`, resumen `name`/`email`/`stage`/`value`) y
  `project.lead_converted`. Alta, alta pública e imports siguen sin
  auditar.
- **Notificaciones**: el alta pública avisa por la campana a los admins
  (`notifyAdmins`, tipo `lead_recibido`).
- **n8n**: sin integración. El `metadata` JSONB y el campo `source`
  pueden alimentar webhooks futuros pero hoy no hay nada conectado.

## Migración y seeds por tenant

### Seeds de tenant

Cada tenant tiene su propio seed que crea schema, fila en
`master.tenants`, usuario admin y registra el módulo `leads` (con
`uiOverride` aunque no se use). Tabla resumen:

| Slug en `master.tenants` | Seed | uiOverride registrado | moduleAccess admin | Leads creados |
| --- | --- | --- | --- | ---: |
| `retorika` | `seed-master.js` + `seed-retorika.js` | (no registra leads) | `["training", "clients"]` | 0 (solo curso) |
| `aumenta` | `seed-aumenta.js` | `aumenta/LeadsModule` | `["leads"]` | ~40 (⚠️ CRM en uso real: no relanzar sin permiso) |
| `demo` | `seed-demo.js` + `add-leads-module-demo.js` | (ninguno desde el 18/08/2026: usa el base; el script aún escribe `demo/LeadsModule` y lo corrige `sincronizar-ui-override.mjs`) | `["clients", "leads", ...]` | 35 |
| `nutri_laura` | `add-leads-module-nutri-laura.js` | `nutri-laura/LeadsModule` | añade `leads` al admin | 8 de ejemplo (uno por etapa; los reales entran por `/api/public/leads` e import) |
| `spain_enzymes` | `seed-spain-enzymes.js` (+ `seed-spain-enzymes-data.js`) | `spain-enzymes/LeadsModule` | `["leads"]` | variable |

(`seed-quality-energy.js` y `seed-abarcaia.js` se borraron con sus clientes el
12/08/2026.) Para un cliente nuevo no hace falta seed: `node
scripts/enable-module.js <slug> leads` enciende el módulo, corre sus
migraciones y abre el `module_access` a los admin.

Los slugs en `master.tenants` que llevan más de una palabra usan
**underscore**, no guión: `nutri_laura`, `spain_enzymes`. Las carpetas de
`modules/overrides/` usan guión (ver "Incoherencias resueltas", punto 4).

### Migraciones y scripts de mantenimiento

Hay **dos migraciones registradas en `scripts/_module-migrations.js`** que
tocan `leads` y corren con `enable-module.js` o con el disparador general:

| Script | Qué hace | Dónde está registrada |
| --- | --- | --- |
| `migrate-stage-to-string.js` | `leads.stage` de ENUM a `VARCHAR(50)` (para admitir las etapas extendidas). | `MODULES.leads` |
| `migrate-leads-columnas-proyecto.js` | Añade `converted_project_id` y `converted_to_project_at`. Va en **CORE** y no en `projects` porque el modelo `Lead` las declara para todos: un tenant con `leads` y sin `projects` se quedaba sin ellas y `Lead.create` moría con 42703 (le pasó a abarcaia del 05/05 al 10/08/2026). | `CORE` |

Scripts sueltos que siguen en `scripts/`:

| Script | Para qué sirve | Estado |
| --- | --- | --- |
| `listar-leads.js <slug>` | Lista los leads de un tenant. | Solo lectura. |
| `mover-leads-a-comerciales.js <slug> <form> [--confirm]` | Leads de familias que entraron por el embudo → bandeja de Comerciales. | Vivo, idempotente. |
| `sincronizar-ui-override.mjs` | Pone el letrero `ui_override` de `master.tenant_modules` a lo que dicen los mapas `UI_OVERRIDES`. | Vivo; relanzar tras añadir/mover/borrar un override. |
| `clear-aumenta-leads.js` | `TRUNCATE` de `leads` en aumenta para resembrar. | **Frenado**: exige la bandera de `_guard-datos-reales.js` (aumenta tiene leads reales). |
| `cleanup-bad-leads.js` | Borraba leads de `crm_quality_energy` con `email IS NULL AND phone IS NULL AND source = 'csv_import'`. | Histórico: hardcodea un schema que **ya no existe**. |

**Histórico (hasta 12/08/2026):** existieron `migrate-quality-leads.js`
(`source` y `metadata` en `crm_quality_energy.leads`; sigue listado en
`ONE_OFF` de `_module-migrations.js` como «atada a quality_energy»),
`clear-quality-leads.js`, `clear-abarcaia-leads.js` y
`remove-abarcaia-from-quality.js` (sacó los leads y referidos de AbarcaIA de
`crm_quality_energy`). Se fueron con los dos clientes.

## Backlog

Detectado durante la documentación (en orden vagamente sugerido):

- **Conversión de lead `won` a `Client`**. spain-enzymes hace una
  conversión parcial desde el frontend; el resto no. (La conversión a
  `Project` ya existe: `POST /api/leads/[id]/convert-to-project`.)
- **Pipeline visual tipo Kanban** de stages (drag-and-drop entre
  columnas).
- **Email automático** al crear o cambiar stage (hoy solo la campana
  interna en el alta pública).
- **Asignación automática a comercial** según reglas (round-robin,
  zona, UTM).
- **Scoring / cualificación automática** (probability poblada
  automáticamente desde valor, fecha esperada, comportamiento).
- **Captcha** en `/api/public/leads` (el rate limiting, 30/min por IP, ya
  está).
- **AuditLog** para lo que falta: alta (`POST`), alta pública e imports
  masivos (PATCH, DELETE y la conversión a proyecto ya auditan).
- **Soft delete** en DELETE (hoy borrado físico auditado).
- **Webhook a n8n** al crear lead o cambiar stage (especialmente
  útil para alertas de stage `won` o `closed_yes`).
- **Asociación Sequelize `Lead.belongsTo(TeamMember, ...)`** para
  filtrar y validar `assignedTo`.
- ~~**Eliminar el override `demo`** o convertirlo en un alias de
  `aumenta` (es prácticamente idéntico).~~ Hecho el 18/08/2026: borrado, y
  la demo usa el base.
- ~~**Mover `ReferidosModule.jsx`** a `modules/overrides/abarcaia/`.~~
  Sin objeto: el módulo Referidos se retiró entero el 12/08/2026.
- **Validación de unicidad de email** al crear lead (al menos como
  warning), o detección de duplicados al importar.

## Incoherencias resueltas en este sprint

**Histórico (sprint de abril-mayo de 2026):** cinco de las nueve
incoherencias detectadas durante la documentación inicial se arreglaron en
el mini-sprint posterior. Se conserva tal cual porque explica de dónde
salen `lib/leads/stages.js` y el guard de admin; los tenants y scripts que
nombra (`quality_energy`, `abarcaia`, `referidos`,
`migrate-quality-leads.js`) **ya no existen** desde el 12/08/2026, y la
lista canónica pasó de 12 a 15 etapas al añadir las tres de nutrición para
`nutri_laura`.

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

Lo que quedó de aquel sprint, puesto al día el 19/08/2026:

- ~~**Decidir el destino de `TenantModule.uiOverride`**.~~ Decidido el
  18/08/2026: es un LETRERO que solo enseña `/admin/modulos`; el código
  sigue resolviendo por el mapa `UI_OVERRIDES` de
  `app/(dashboard)/leads/page.jsx`, y `scripts/sincronizar-ui-override.mjs`
  mantiene la columna fiel a esos mapas. Añadir un tenant con override sigue
  exigiendo editar el page.jsx (y, por la regla #16 de CLAUDE.md, es el
  último peldaño).

- ~~**Mover `ReferidosModule.jsx`** a `modules/overrides/abarcaia/`.~~
  ~~**Re-seed o re-diseño de stages en `quality_energy`**.~~ Sin objeto:
  los dos clientes se dieron de baja y su código se borró el 12/08/2026.

- ~~**Auditoría en DELETE**.~~ Hecha: `lead.deleted` (y `lead.updated`).
  Queda el **soft delete** (flag o paranoid mode de Sequelize) como
  mejora.

- ~~**Rate limiting**~~ hecho (30/min por IP). Queda el **captcha** en
  `/api/public/leads`.

- **Asociación Sequelize `Lead.belongsTo(TeamMember)`** para validar
  `assignedTo` y permitir filtros por comercial.

- **Conversión de lead `won` a `Client`** automática (a `Project` ya
  existe).

- ~~**Eliminar el override `demo`** o convertirlo en alias de `aumenta`
  (es prácticamente idéntico).~~ Hecho el 18/08/2026.
