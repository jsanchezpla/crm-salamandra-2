# Módulo Configuración

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | sin moduleKey: lo tienen todos. La página no lleva `hasModule`; el enlace del sidebar es el icono de engranaje del pie (`components/layout/Sidebar.jsx`) y solo lo ven `admin`/`superadmin`, y `GET` y `PATCH` de `/api/tenant/settings` exigen ese rol (fresco de BD, vía `withTenant`) |
| **Reina** | — |
| **Pantallas** | `app/(dashboard)/configuracion/page.jsx` → `/configuracion` (una sola página; dentro, secciones de Facturación, IA, integraciones, Citas y Captación) · el back-office la complementa desde `app/admin/page.jsx` (ficha de Custodia, `/admin`): nosotros también podemos poner las claves |
| **Endpoints** | `app/api/tenant/settings/route.js` (GET/PATCH, 1) · `app/api/ai-permisos/**` (2: `route.js`, `[id]/route.js`, el candado de IA) · `app/api/admin/configuraciones/route.js` (1, back-office: pone credenciales sin leerlas nunca) · la pantalla reutiliza además `app/api/billing/settings`, `app/api/outreach/settings`, `app/api/outreach/business-lines/**` y `app/api/clinica/derivaciones` · públicos: ninguno |
| **Lógica** | `lib/configuracion/avisoCambio.js` (recibo por correo de cada cambio, enviado con la cuenta de Salamandra) · `lib/crypto/secretBox.js` (AES-256-GCM, prefijo `enc:v1:`) · resolvers que LEEN lo que aquí se guarda: `lib/ai/anthropicKey.js`, `lib/ai/anthropicModel.js` (`ANTHROPIC_MODELS`, Sonnet por defecto), `lib/ai/openaiKey.js`, `lib/ai/aiAccess.js` (`vetoAi`, candado `settings.aiAccess`), `lib/outreach/resendConfig.js`, `lib/payments/stripeConfig.js`, `lib/analytics/cloudflareConfig.js`, `lib/whatsapp/whatsappConfig.js`, `lib/citas/videollamada.js` (`settings.citas.meetModo`), `lib/citas/coloresBloqueo.js` · back-office: `lib/provisioning/credencialesCliente.js` (solo escribir), `lib/provisioning/contactoCliente.js` (`settings.contacto`) · plantilla del recibo: `lib/email/templates/configuracion/cambioAplicado.js` |
| **UI** | `modules/config/ConfigModule.jsx` (2.464 líneas, todo en un fichero: `ApiKeyCard`, `AiPermissionsCard`, las tarjetas de Citas, `CompanyDescriptionSection`…) · no hay `components/config/`; usa `components/ui/Select.jsx` y `components/ui/HelpTooltip.jsx` |
| **Modelos** | `models/master/Tenant.model.js` — todo va en `master.tenants.settings` (JSONB: `brand`, `integrations`, `aiAccess`, `citas`, `clientes`, `contacto`), sin migración · `models/tenant/AiPermission.model.js` (`ai_permissions`: solicitudes y concesiones del candado de IA) · `models/master/AuditLog.model.js` (`master.audit_logs`) recibe cada cambio, sin el valor de los secretos |
| **Interruptores y parámetros** | ninguno que lea el código (no hay fila en `tenant_modules`). Lo que esta pantalla escribe vive en `master.tenants.settings`, no en `featureFlags`: `integrations.*` (Anthropic, OpenAI, Google Places, Resend, Stripe, WhatsApp, Cloudflare; los secretos cifrados, `anthropicModel` en claro), `aiAccess` (`libre` / `restringido`), `citas.*` (`meetModo`, `recordatoriosCitas`, `agendaCompartida`, `avisosWhatsapp`, `portalBloqueoImpago`, `cancelacionBloqueada`, `reservaOnlineCerrada`, `formularioObligatorio`, `contratoObligatorio`, `soloConPago`, `identidadObligatoria`, `formularioUrl`, `portalUrl`, `reservaUrl`, `colorBloqueos`), `clientes.categoriasExternas`, `brand`, `name` |
| **Pantallas propias** | ninguna (`app/(dashboard)/configuracion/page.jsx` no tiene mapa `UI_OVERRIDES`) |
| **Scripts** | no hay activación: no es módulo · `_hechos/encrypt-tenant-secrets.js` (cifra en reposo claves guardadas antes en claro; idempotente) · `migrate-ai-permissions.js` (crea `ai_permissions` en todos los schemas) · `configure-stripe-tenant.js` (claves de Stripe leídas de variables de entorno, nunca de argumentos) · solo lectura: `inspect-tenant-modules.js <slug>` |
| **Pruebas** | `_smoke-backoffice-ciclo.mjs` (base de datos; el camino del back-office: la clave se guarda cifrada, no se devuelve jamás, a una demo no se le pone) · nada cubre `/api/tenant/settings` ni `/api/ai-permisos` directamente; `_smoke-retencion-viva-o-muerta.mjs` solo usa `secretBox` para sembrar |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` (guard de la demo en escrituras a master, auditoría con resumen) · `../decisions/2026-08-13-ciclo-de-vida-de-un-cliente.md` (`credencialesCliente.js`: nosotros también ponemos las claves, y solo escribimos) |
| **En este doc** | «Secciones» · «Dónde se guardan las claves (y por qué son seguras)» · «API — `/api/tenant/settings`» · «Ficheros» · «Permisos de IA del equipo (2026-07-27)» · «WhatsApp (Meta Cloud API) — 2026-07-27» · «Enlace de videollamada de las citas — 2026-07-27» |

Ruta: `/configuracion` · API: `/api/tenant/settings` · UI: `modules/config/ConfigModule.jsx`

Página de ajustes del tenant. No es un módulo con `moduleKey` propio: la tienen
todos los tenants. **Histórico (hasta 27/07/2026):** era una entrada del menú,
sección «Ajustes», con `always: true`; ese flag ya no existe. Hoy el enlace es
el **icono de engranaje del pie** del sidebar (`components/layout/Sidebar.jsx`,
«Ayuda · Soporte · Configuración · Cerrar sesión», decisión del socio del
27/07) y **solo lo ven `admin` / `superadmin`**; `GET` y `PATCH` de
`/api/tenant/settings` exigen ese mismo rol (fresco de BD, vía `withTenant`): el
GET expone pistas enmascaradas de las claves, así que no es para cualquiera.

Nació (07/2026) para dar de alta, en autoservicio, las **claves de IA por
tenant** (BYOK) que consumía el módulo Outreach. Hoy es la pantalla donde el
cliente pone TODO lo que es suyo y no del CRM: las credenciales de cada
servicio externo (Anthropic, OpenAI, WhatsApp, Google Places, Cloudflare,
Resend, Stripe), el candado de IA del equipo, los **diez** interruptores y las
URLs del módulo Citas, las empresas de las consultas externas y las
derivaciones de Clínica. Todo se guarda en `master.tenants.settings` (JSONB) y
cada cambio deja su fila en `AuditLog` y un recibo por correo al cliente
(`lib/configuracion/avisoCambio.js`).

---

## Secciones

### 1. Facturación

Reutiliza el endpoint existente `/api/billing/settings` (modelo
`TenantBillingSettings`, fila única por tenant). Muestra y edita los datos
fiscales básicos: razón social, NIF/CIF, dirección, ciudad, CP, país, IVA por
defecto, IRPF por defecto y días de vencimiento. Enlaza a la **configuración
completa** de facturación (`/facturacion/configuracion`) para series, todos los
tipos de IVA, etc.

Solo aparece si el tenant tiene el módulo `billing` (si el GET responde 403, la
sección se oculta).

### 2. Inteligencia Artificial e integraciones (BYOK)

Bajo el rótulo «Inteligencia Artificial» van **ocho tarjetas** `ApiKeyCard`
con **alta guiada** de la clave (tutorial de pasos + botón a la plataforma +
campo para pegar la clave), estilo autoservicio con fricción (`AI_PROVIDERS`
en `modules/config/ConfigModule.jsx`). Nacieron dos (Anthropic y Google
Places, 07/2026); hoy:

| Tarjeta | Clave | La usa | Plataforma |
| ------- | ----- | ------ | ---------- |
| **Anthropic (Claude)** | `anthropicApiKey` (+ selector `anthropicModel`) | La IA de TODO el CRM: Outreach (`/analizar`), sesiones e informes clínicos, Proyectos, Soporte, Citas, Calendario, asistente | console.anthropic.com |
| **OpenAI (Whisper)** | `openaiApiKey` | Transcripción de audio de sesiones clínicas (voz → texto) con la API de Whisper | platform.openai.com |
| **WhatsApp (Meta Cloud API)** | `whatsappToken` (+ `whatsappPhoneNumberId`, en claro) | Avisos de cita por WhatsApp (`lib/whatsapp/whatsappConfig.js`); ver más abajo | developers.facebook.com |
| **Google Cloud (Places)** | `googlePlacesApiKey` | `"Buscar nuevos"` de Google Maps (Outreach) | console.cloud.google.com |
| **Cloudflare (visitas de la web)** | `cloudflareApiToken` (+ `cloudflareAccountId`, `cloudflareSiteTag`, en claro; `ready` solo con las piezas) | Módulo Analíticas (`lib/analytics/cloudflareConfig.js`). El token se valida por FORMA al pegarlo (≥30 caracteres `[A-Za-z0-9_-]`) | dash.cloudflare.com |
| **Resend (correo)** | `resendApiKey` (+ `resendFromEmail`, `resendReplyTo`, tarjeta «Remitente del correo») | El correo que sale del CRM en nombre del cliente: correo modelo de Outreach, pautas de nutrición, avisos de citas… (`lib/outreach/resendConfig.js`) | resend.com |
| **Stripe — clave secreta** | `stripeSecretKey` (+ `stripePublishableKey`, en claro, tarjeta «Clave publicable de Stripe») | Cobrar por adelantado las citas con precio (`lib/payments/stripeConfig.js`); `ready` y `liveMode` se deducen de las claves | dashboard.stripe.com |
| **Stripe — secreto del webhook** | `stripeWebhookSecret` | Lo que nos avisa de que un pago se ha completado; sin él el paciente paga y su cita no se confirma (la tarjeta enseña la URL del webhook) | dashboard.stripe.com |

Y, después de las tarjetas de clave y en la misma página, lo que NO es una
credencial: la tarjeta **«Permisos de IA del equipo»** (`AiPermissionsCard`,
candado `aiAccess`), los **diez interruptores de Citas** con sus tres URLs y el
color de los bloqueos (`RecordatoriosCard`, `AgendaCompartidaCard`,
`AvisosWhatsappCard`, `BloqueoImpagoCard`, `CancelacionCard`,
`ReservaOnlineCard`, `PuertaAdmisionCard`, `PuertaContratoCard`,
`PuertaCajaCard`, `PuertaIdentidadCard`, `AreaPrivadaCard`,
`PaginaReservasCard`, `ColorBloqueosCard`, `VideollamadaCard`), las empresas
de las consultas externas (`CategoriasExternasCard`,
`settings.clientes.categoriasExternas`) y las derivaciones de Clínica
(`DerivacionesCard`, que lee y escribe `/api/clinica/derivaciones` y se
esconde sola con el 403 de quien no tiene Clínica).

> **Transcripción de audio (sesiones clínicas):** Claude NO transcribe audio, así que
> el paso voz→texto lo hace la **API de Whisper de OpenAI** (clave `openaiApiKey`,
> por-tenant, cifrada; resolver `lib/ai/openaiKey.js`). Luego Claude hace el
> resumen/estructura (texto → sesión).

> **Modelo de Claude (selector):** debajo de la clave de Anthropic hay un selector de
> modelo — **Sonnet (por defecto)** · Opus · Haiku. Se guarda en
> `settings.integrations.anthropicModel` (sin cifrar, no es secreto) y se aplica a
> **TODO el CRM** vía `getTenantAnthropicModel(ctx)` (`lib/ai/anthropicModel.js`).
> Sonnet por defecto porque Opus consume muchos más tokens. Lista de modelos
> admitidos: `ANTHROPIC_MODELS` (misma fuente que valida el backend y pinta la UI).

Cada tarjeta muestra estado **Conectada / Sin configurar** con una pista
enmascarada (p.ej. `AIza…1234`), y permite reemplazar o eliminar la clave.

> La sección "Datos del tenant" (nombre, colores, logo) existió y se retiró a
> petición. El endpoint sigue soportando `name` y `brand` por si se reactiva.

### 3. Descripción de empresa (alimenta Captación)

Solo aparece si el tenant tiene el módulo **Outreach** (el GET de
`/api/outreach/settings` responde 403 si no, y la sección se oculta —mismo patrón
que Facturación). **Reutiliza los datos ya existentes de Outreach**, no crea un
concepto nuevo:

- **Descripción general de la empresa** → `OutreachSettings.companyContext`
  (`PATCH /api/outreach/settings`). Encabeza el system prompt del análisis.
- **Líneas de negocio** (título + descripción, plegables, añadir/editar/activar) →
  modelo `OutreachBusinessLine` (`GET`/`POST /api/outreach/business-lines`,
  `PATCH /api/outreach/business-lines/[id]`). Cada línea es un servicio contra el
  que la IA puntúa a cada lead.

Detalles de implementación:

- Al **crear** una línea, la `key` (id estable e **inmutable**, porque los
  `OutreachAnalysis` la referencian) se **autogenera** del título con un slugify
  (`á→a`, no alfanumérico → `_`), resolviendo colisiones con sufijo `_2`, `_3`…
  El usuario no la ve ni la escribe.
- Al **editar**, el `PATCH` envía **solo** `name`/`description`/`active`: así el
  servidor **conserva** `scoringUp`/`scoringDown` (señales de scoring), que se
  siguen editando en el editor avanzado `/outreach/configuracion`.
- "Config. avanzada →" enlaza a `/outreach/configuracion` (scoring, regla de
  encadenamiento, modelo del análisis). Esta sección de Configuración es el
  editor **simple**; el de Outreach es el **avanzado** (mismos datos).
- Escritura solo admin (los endpoints de Outreach comprueban `x-user-role`).

Consecuencia en Captación: ya **no** se piden las líneas al analizar. El análisis
usa la descripción general + las líneas, y en la **ficha del lead** se puede
elegir qué líneas analizar para esa empresa (ver `docs/modules/outreach.md`).

---

## Dónde se guardan las claves (y por qué son seguras)

Las claves viven en **`master.tenants.settings.integrations`** (JSONB), junto
al resto de lo que guarda esta pantalla:

```json
{
  "brand": { ... },
  "integrations": {
    "anthropicApiKey": "enc:v1:…", "anthropicModel": "claude-sonnet-…",
    "openaiApiKey": "enc:v1:…", "googlePlacesApiKey": "enc:v1:…",
    "whatsappToken": "enc:v1:…", "whatsappPhoneNumberId": "…",
    "cloudflareApiToken": "enc:v1:…", "cloudflareAccountId": "…", "cloudflareSiteTag": "…",
    "resendApiKey": "enc:v1:…", "resendFromEmail": "…", "resendReplyTo": "…",
    "stripeSecretKey": "enc:v1:…", "stripeWebhookSecret": "enc:v1:…", "stripePublishableKey": "pk_…"
  },
  "aiAccess": "libre",
  "citas": { "meetModo": "manual", "recordatorios": false, "…": "…" },
  "clientes": { "categoriasExternas": [] },
  "contacto": { ... }
}
```

Son **secretos**, y se protegen así:

1. **Cifradas en reposo** (AES-256-GCM, `lib/crypto/secretBox.js`) con
   `SETTINGS_ENCRYPTION_KEY` del entorno. En la BD solo hay texto cifrado
   (`enc:v1:…`): un dump o backup filtrado **no sirve** sin esa clave, que nunca
   está en la base de datos. Se cifra al guardar y se descifra al usar.
1. **La API nunca las devuelve en claro.** `GET /api/tenant/settings` devuelve
   solo `{ configured, hint }` por clave (estado + pista corta).
2. **No llegan al cliente.** El layout del dashboard (`app/(dashboard)/layout.jsx`)
   **elimina `settings.integrations`** del tenant antes de serializarlo al
   navegador (es el único punto que pasa el tenant entero al cliente).
3. **Escritura solo admin**, y tras guardar se llama a `invalidateTenantCache`
   para que Outreach vea la clave nueva de inmediato (la caché de tenant dura ~60s).

Consumo desde Outreach:
- `analizar` lee la clave del tenant vía `getTenantAnthropicKey(ctx)`
  (`lib/ai/anthropicKey.js`). **Sin fallback de entorno**: sin clave → `503`.
- `buscar-nuevos` lee la clave de Google del tenant y la **descifra** con
  `decryptSecret` (sin fallback de entorno).

### También se las podemos poner NOSOTROS (13/08/2026)

Además de esta pantalla, las credenciales de un cliente se pueden poner desde el
back-office, en la ficha de Custodia (`PUT /api/admin/configuraciones`,
`lib/provisioning/credencialesCliente.js`). Existe porque los clientes no
entraban aquí: **1 de 9 tenía clave de Anthropic y 0 de 9 la de OpenAI**, con
once disparadores de IA desplegados y sin usar por nadie.

Los cuatro puntos de arriba **siguen valiendo igual** por ese camino, y uno más:

- El campo es de **solo escribir**. La regla del back-office —«no descifra
  nada»— no se ha tocado: escribir una clave no obliga a leer la anterior. La
  respuesta dice `puesta`, `cambiada` o `borrada` y nunca el valor, ni
  enmascarado. Ahí NO hay `hint`; la pista enmascarada solo existe en esta
  pantalla, que es la del propio cliente.
- Se cifra con el mismo `secretBox` y se invalida la misma caché.
- **A las demos no se les pone ninguna** (409): son públicas y dan sesión de
  admin a cualquiera.
- **El cliente recibe el mismo recibo por correo**, firmado como Salamandra en
  vez de con el nombre de alguien de su equipo.

Y en `settings.contacto` se apunta a quién se le escribe cuando hay que pedirle
algo (`lib/provisioning/contactoCliente.js`). No confundir con el `adminEmail`
del alta, que es el USUARIO con el que entra.

---

## API — `/api/tenant/settings`

Los dos métodos exigen **rol admin/superadmin** (fresco de BD). El PATCH lleva
además `assertNotDemoMasterWrite`: la demo es pública y da sesión de admin a
cualquiera.

| Método | Qué hace |
| ------ | -------- |
| `GET` | Devuelve `name`, `slug`, `plan`, `readOnly` (la demo), `brand`, `aiAccess`, `meetModo`, `salasVideollamada`, los diez booleanos de Citas (`recordatoriosCitas`, `agendaCompartida`, `portalBloqueoImpago`, `cancelacionBloqueada`, `reservaOnlineCerrada`, `avisosWhatsapp`, `formularioObligatorio`, `contratoObligatorio`, `soloConPago`, `identidadObligatoria`), `formularioUrl`, `portalUrl`, `reservaUrl`, `colorBloqueos`, `categoriasExternas` e `integrations: { anthropic:{configured,hint,model}, googlePlaces, openai, cloudflare:{…,accountId,siteTag,ready}, whatsapp:{…,phoneNumberId}, resend:{…,fromEmail,replyTo}, stripe:{…,publishableKey,webhook,ready,liveMode} }`. Cada clave, solo `{ configured, hint }`; nunca en claro, y **en la demo ni la pista** (`hint: null`) |
| `PATCH` | Acepta `name`, `brand`; los secretos `anthropicApiKey`, `openaiApiKey`, `googlePlacesApiKey`, `resendApiKey`, `whatsappToken`, `cloudflareApiToken`, `stripeSecretKey`, `stripeWebhookSecret` (cifrados con `applyKey`; **500 si falta `SETTINGS_ENCRYPTION_KEY`**, para no guardar nunca uno en claro); los planos `anthropicModel` (lista cerrada), `resendFromEmail`, `resendReplyTo`, `whatsappPhoneNumberId`, `cloudflareAccountId`, `cloudflareSiteTag`, `stripePublishableKey`; `aiAccess` (`libre`/`restringido`); `meetModo` (`manual`/`automatico`); los diez booleanos de Citas; `formularioUrl`, `portalUrl`, `reservaUrl` (solo http(s) absolutas: se le sirven a un tercero en un enlace); `colorBloqueos` (hex); `categoriasExternas` (lista, se guarda limpia y deduplicada). Calcula el diff, audita `configuracion.updated` (sin el valor de los secretos), manda el recibo por correo e invalida la caché de tenant |

Semántica de las claves en `PATCH`:

- `undefined` → no se toca (permite guardar la marca sin perder la clave).
- `null` o `""` → se borra.
- string → se fija (trim).

⚠️ **Lo que el PATCH guarda lo tiene que DEVOLVER** (05/08/2026): la pantalla
hace `setCfg({...c, ...data})`, así que un interruptor que se guarde pero no
vuelva en la respuesta se queda pintado con el valor viejo. Pasó con las cuatro
puertas de la agenda: Rodrigo encendió tres sin que la pantalla lo enseñara.

No hay migración: `settings` es JSONB, ya existe en `master.tenants`.

> **LA CONFIGURACIÓN ES UNIVERSAL** (criterio de Rodrigo, 01/08/2026). Las
> tarjetas de integración —Anthropic, OpenAI, WhatsApp, Google Places,
> Cloudflare, Resend— se muestran en **TODOS los tenants**, usen o no ese
> servicio, y no se gatean por módulo. Un cliente que mañana quiera WhatsApp o
> analítica de visitas tiene que poder conectarlo sin que nadie toque código.
> Verificado el 01/08: ninguna tarjeta lleva `hasModule`.

Interruptores de Citas que viajan por el mismo `PATCH` — **diez**, todos
booleanos y todos **apagados** por defecto (los dos «en negativo» lo están para
leerse con `=== true` como sus hermanos: apagado = se puede anular / se reserva
online, que es como se comportó siempre):

| Interruptor | `settings.citas.*` | Qué hace |
| --- | --- | --- |
| `recordatoriosCitas` | `recordatorios` | Correo la víspera de la cita (`lib/citas/recordatorios.js`) |
| `agendaCompartida` | `agendaCompartida` | Todo el equipo ve la agenda completa, con los datos del paciente (`lib/citas/visibilidad.js`). Aumenta la tiene encendida desde el 01/08 |
| `avisosWhatsapp` | `avisosWhatsapp` | Los avisos de cita también por WhatsApp (necesita la tarjeta de Meta) |
| `portalBloqueoImpago` | `portalBloqueoImpago` | Sprint Aumenta 2026-07, punto 2.3: el área privada se abre mes a mes al registrar el cobro |
| `cancelacionBloqueada` | `cancelacionBloqueada` | La familia NO puede anular sus citas (`lib/citas/cancelacion.js`) |
| `reservaOnlineCerrada` | `reservaOnlineCerrada` | El centro no da cita por internet (`lib/citas/puertaReserva.js`) |
| `formularioObligatorio` | `formularioObligatorio` (+ `formularioUrl`) | Puerta de admisión: solo reserva quien tiene el formulario aceptado |
| `contratoObligatorio` | `contratoObligatorio` | Puerta de contratos (04/08): sin firmar no se reserva, salvo la valoración inicial (`lib/citas/puertaContrato.js`) |
| `soloConPago` | `soloConPago` | Puerta de caja (05/08): desde la agenda pública solo lo que se cobra (`lib/citas/tiposVisibles.js`) |
| `identidadObligatoria` | `identidadObligatoria` | Puerta de identidad (05/08): sin cuenta no se reserva (`exigeIdentidad`) |

Con ellos viajan `meetModo` (ver «Enlace de videollamada»), las URLs de la web
del cliente (`formularioUrl`, `portalUrl`, `reservaUrl`) y `colorBloqueos`. El
detalle de cada puerta está en `docs/modules/citas.md`; todos quedan anotados
en `AuditLog` al cambiarlos.

---

## Ficheros

- `app/(dashboard)/configuracion/page.jsx` — página (renderiza el módulo).
- `modules/config/ConfigModule.jsx` — UI (facturación + IA + tarjetas de clave +
  interruptores de Citas + candado de IA + empresas externas + derivaciones;
  todo en un fichero).
- `app/api/tenant/settings/route.js` — GET/PATCH, enmascarado, diff para la
  auditoría, recibo por correo e `invalidateTenantCache`.
- `lib/configuracion/avisoCambio.js` — el recibo por correo de cada cambio.
- `app/(dashboard)/layout.jsx` — elimina `settings.integrations` antes del cliente.
- `components/layout/Sidebar.jsx` — el engranaje del pie (solo admin); ya no es
  una entrada del menú ni lleva `always: true`.

---

## Cifrado en reposo (hecho)

Las claves se guardan **cifradas** (AES-256-GCM) con `SETTINGS_ENCRYPTION_KEY`.
Detalle en `lib/crypto/secretBox.js`. Migración para cifrar claves antiguas en
claro: `scripts/_hechos/encrypt-tenant-secrets.js` (idempotente). Sin la env var, se
guardan en claro (aviso por stderr) — hay que configurarla en el `.env`.

## Permisos de IA del equipo (2026-07-27)

La IA de pago (Claude, Whisper, Google Places) puede quedar bajo candado por
tenant: `settings.aiAccess` = `"libre"` (default, nada cambia) o
`"restringido"`. Con el candado, un usuario NO-admin que dispare una acción de
IA recibe un 403 y se crea sola una solicitud (tabla tenant `ai_permissions`);
los admins reciben aviso por la campana y deciden en Configuración → IA
(tarjeta «Permisos de IA del equipo»): **Siempre** (concesión general),
**Solo una vez** (se consume con el primer uso) o **Denegar**; lo concedido se
puede **Revocar**. El solicitante recibe la decisión por la campana.

Piezas:
- Gate: `lib/ai/aiAccess.js` → `vetoAi(ctx, request, accion)` (estilo RETURN,
  no throw: varios handlers de IA tienen try/catch propio). Está en los **11**
  endpoints de IA (eran 7 el 27/07): `clinica/sessions/transcribe`,
  `clinica/reports/[id]/pulir`, `clinica/performance/config/ai`, `outreach`
  `analizar` y `buscar-nuevos`, `tickets/[id]/ai`, `assistant`
  (Salamandrobot), `calendar/reorganize`, `citas/bookings/[id]/suggest-slots`,
  `projects/ai/generate` y `projects/[id]/ai/edit`. Todo uso PERMITIDO audita
  `ai.uso` en master. Un endpoint de IA nuevo lo lleva o se salta el candado.
- Panel: `GET /api/ai-permisos` + `PATCH /api/ai-permisos/[id]`
  (decision: conceder-general | conceder-una-vez | denegar | revocar).
  Solo admin con rol fresco de BD; PATCH vetado en la demo.
- Flag: whitelisted en el PATCH de `/api/tenant/settings` (lista cerrada,
  patrón anthropicModel); el GET lo expone como `aiAccess`.
- Migración: `scripts/migrate-ai-permissions.js` (CORE, todos los schemas).
- Auditoría de decisiones: `ai.permiso_concedido|denegado|revocado`.
- Fallo del sistema de permisos = cerrado (nunca IA gratis por error).

## WhatsApp (Meta Cloud API) — 2026-07-27

BYOK como el resto: cada tenant pone su cuenta de WhatsApp Business en
Configuración. Dos campos en `settings.integrations`:
`whatsappToken` (CIFRADO, patrón `applyKey`) y `whatsappPhoneNumberId` (plano).
Resolver: `lib/whatsapp/whatsappConfig.js` → `getTenantWhatsappConfig(ctx)`,
`tenantTieneWhatsapp(ctx)` y `enviarWhatsapp(ctx, {telefono, texto})` (Cloud API
v21, best-effort: devuelve `{ok:false,error}` y NUNCA lanza).

**Histórico (hasta 01/08/2026):** la infraestructura estaba lista pero ningún
flujo mandaba mensajes solo. Desde ese día los **avisos de cita** salen también
por WhatsApp si el interruptor `avisosWhatsapp` está encendido y la familia no
ha dicho que no (`lib/citas/avisosWhatsapp.js`: lo comparten «Guardar y
enviar», la confirmación de la cita y el recordatorio de la víspera). Menú de
nutrición y aviso de ticket siguen sin engancharse. Ojo con la regla de Meta: el
primer mensaje a alguien que no ha escrito en 24h exige plantilla aprobada.

## Enlace de videollamada de las citas — 2026-07-27

`settings.citas.meetModo`: `"manual"` (POR DEFECTO) o `"automatico"`.
Resolver: `lib/citas/videollamada.js` → `meetUrlInicial(tenant, eventType, modality)`,
usado por el alta del panel y por la reserva pública.

- **manual**: la cita online nace SIN enlace. Se pega en su ficha y con el botón
  **«Guardar y enviar»** se manda por email al paciente — funciona SIEMPRE, también
  al corregir un enlace ya guardado (antes solo se enviaba en la transición
  null→valor y no había forma de reenviar desde la UI).
- **automatico**: hereda el enlace de sala fija del tipo de cita. NO genera salas
  en Google (eso exige la integración con Google Calendar, aún no construida).

## Pendiente / ideas

- Reactivar "Datos del tenant" (marca/logo) si se necesita edición desde aquí.
- Rotación/re-cifrado de secretos si algún día se rota `SETTINGS_ENCRYPTION_KEY`.
