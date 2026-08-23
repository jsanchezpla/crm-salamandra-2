# Módulo Configuración

Ruta: `/configuracion` · API: `/api/tenant/settings` · UI: `modules/config/ConfigModule.jsx`

Página de ajustes del tenant. No es un módulo con `moduleKey` propio: la entrada
del sidebar (sección **Ajustes**) es **siempre visible** para cualquier tenant
(como "Inicio"), mediante el flag `always: true` en `components/layout/Sidebar.jsx`.

Su razón de ser principal hoy: dar de alta, en autoservicio, las **claves de IA
por tenant** (BYOK) que consume el módulo Outreach.

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

### 2. Inteligencia Artificial (BYOK)

Dos tarjetas con **alta guiada** de la clave (tutorial de pasos + botón a la
plataforma + campo para pegar la clave), estilo autoservicio con fricción:

| Tarjeta | Clave | La usa | Plataforma |
| ------- | ----- | ------ | ---------- |
| **Anthropic (Claude)** | `anthropicApiKey` | Análisis IA de Outreach (`/analizar`) + resumen/estructura de sesiones clínicas | console.anthropic.com |
| **OpenAI (Whisper)** | `openaiApiKey` | Transcripción de audio de sesiones clínicas (voz → texto) con la API de Whisper | platform.openai.com |
| **Google Cloud (Places)** | `googlePlacesApiKey` | `"Buscar nuevos"` de Google Maps | console.cloud.google.com |
| **Resend (correo captación)** | `resendApiKey` (+ `resendFromEmail`, `resendReplyTo`) | Enviar el correo modelo en frío | resend.com |

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

Las claves viven en **`master.tenants.settings.integrations`** (JSONB):

```json
{ "brand": { ... }, "integrations": { "anthropicApiKey": "...", "googlePlacesApiKey": "..." } }
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

| Método | Qué hace |
| ------ | -------- |
| `GET` | Devuelve `{ name, slug, plan, brand, integrations: { anthropic:{configured,hint}, googlePlaces:{configured,hint} } }`. Nunca la clave en claro |
| `PATCH` | **Admin.** Acepta `name`, `brand`, `anthropicApiKey`, `anthropicModel`, `openaiApiKey`, `googlePlacesApiKey`, `resendApiKey` (+ `resendFromEmail`/`resendReplyTo`). Invalida la caché de tenant |

Semántica de las claves en `PATCH`:

- `undefined` → no se toca (permite guardar la marca sin perder la clave).
- `null` o `""` → se borra.
- string → se fija (trim).

No hay migración: `settings` es JSONB, ya existe en `master.tenants`.

> **LA CONFIGURACIÓN ES UNIVERSAL** (criterio de Rodrigo, 01/08/2026). Las
> tarjetas de integración —Anthropic, OpenAI, WhatsApp, Google Places,
> Cloudflare, Resend— se muestran en **TODOS los tenants**, usen o no ese
> servicio, y no se gatean por módulo. Un cliente que mañana quiera WhatsApp o
> analítica de visitas tiene que poder conectarlo sin que nadie toque código.
> Verificado el 01/08: ninguna tarjeta lleva `hasModule`.

Interruptores de Citas que viajan por el mismo `PATCH` (todos booleanos, todos
**apagados** por defecto): `recordatoriosCitas`, `agendaCompartida` y
`avisosWhatsapp` (avisos de cita también por WhatsApp) y `portalBloqueoImpago` (sprint Aumenta 2026-07, punto 2.3 — los documentos del
área privada se abren mes a mes al registrar el cobro de ese mes; detalle en
`docs/modules/citas.md`). Los cuatro quedan anotados en `AuditLog` al cambiarlos.

---

## Ficheros

- `app/(dashboard)/configuracion/page.jsx` — página (renderiza el módulo).
- `modules/config/ConfigModule.jsx` — UI (facturación + IA + tarjetas de clave).
- `app/api/tenant/settings/route.js` — GET/PATCH, enmascarado y `invalidateTenantCache`.
- `app/(dashboard)/layout.jsx` — elimina `settings.integrations` antes del cliente.
- `components/layout/Sidebar.jsx` — entrada "Configuración" (`always: true`).

---

## Cifrado en reposo (hecho)

Las claves se guardan **cifradas** (AES-256-GCM) con `SETTINGS_ENCRYPTION_KEY`.
Detalle en `lib/crypto/secretBox.js`. Migración para cifrar claves antiguas en
claro: `scripts/encrypt-tenant-secrets.js` (idempotente). Sin la env var, se
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
  no throw: varios handlers de IA tienen try/catch propio). Está en los 7
  endpoints de IA: clinica/transcribe, outreach analizar y buscar-nuevos,
  tickets/[id]/ai, assistant (Salamandrobot), calendar/reorganize y
  citas suggest-slots. Todo uso PERMITIDO audita `ai.uso` en master.
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
`tenantTieneWhatsapp(ctx)`, `enviarWhatsapp(ctx, {telefono, texto})` (texto
libre, **solo válido dentro de la ventana de 24 h**) y
`enviarWhatsappPlantilla(ctx, {telefono, plantilla, parametros, clientId})`
(plantilla aprobada, válida siempre). Cloud API v21, best-effort: devuelven
`{ok:false,error}` y NUNCA lanzan.

Estado a 17/08/2026: los tres avisos de cita ya salen por plantilla
(`docs/modules/citas.md` → «Los tres avisos van por PLANTILLA»), y lo enviado y
lo recibido se guarda en `whatsapp_messages`. Pendiente: los avisos de nutrición
y de soporte, y una pantalla que enseñe el hilo en la ficha.

### Mensajes ENTRANTES (webhook)

`app/api/webhooks/whatsapp/[tenantSlug]` recibe lo que escriben los pacientes,
los acuses de entrega y —al conectar la coexistencia— los 180 días de historial.
Una URL POR CLIENTE (`override_callback_uri` por cuenta de WhatsApp), con el
slug en la ruta: el destino lo fija nuestra configuración en Meta, no el
contenido de la petición.

Dos variables de entorno, NUESTRAS y no del tenant, porque siendo Tech Provider
todas las cuentas cuelgan de la misma app: `WHATSAPP_APP_SECRET` (firma cada
webhook) y `WHATSAPP_WEBHOOK_SECRET` (del que se DERIVA el token de
verificación de cada cliente, `verifyTokenFor(slug)`, para no tener que guardar
un secreto más por tenant). Sin las dos, el endpoint responde 503 y no toca la
base. Detalle en `lib/whatsapp/webhookAuth.js` e `inbox.js`.

Ejercitado por `scripts/_smoke-webhook-whatsapp.mjs` (23/08/2026), que firma los
payloads igual que los firma Meta y fija las cuatro propiedades que fallan en
silencio: que la firma es la única llave y va sobre los **bytes exactos** del
cuerpo, que el tenant lo decide el slug de la URL y no el payload (el token de
un cliente no abre la puerta de otro, y lo entregado en uno no aparece en el
schema del otro), que un reintento de Meta no duplica el hilo, y a qué ficha se
cuelga cada conversación —incluido que un número compartido por dos fichas se
deja **sin asignar** en vez de adivinar—. También los acuses de entrega, con el
`read` que no retrocede a `delivered` cuando llegan desordenados.

Se escribió a la vez que su primer hallazgo: un mensaje **saliente** del
historial no siempre trae `to`, y se guardaba con el teléfono en blanco y sin
ficha. No se perdía, pero desaparecía del hilo del paciente, que es el único
sitio donde alguien lo va a buscar. Ahora se cae al wa_id del hilo, que Meta ya
manda y el endpoint tiraba.

### El botón «Conectar mi WhatsApp» (Embedded Signup)

`modules/config/ConectarWhatsapp.jsx` abre la ventana de Meta y
`POST /api/whatsapp/conectar` remata: canjea el código por el token permanente
del cliente, suscribe nuestra app a SU cuenta con SU `override_callback_uri`, y
lo guarda cifrado. La lógica contra Meta, en `lib/whatsapp/embeddedSignup.js`.

Es lo que hace vendible la integración: sin esto, cada cliente tendría que
crearse una app en developers.facebook.com y sacar un token de un usuario del
sistema. Y sobre todo, **es la única vía que conserva sus conversaciones**: la
alta manual de un número obliga a borrar su cuenta de WhatsApp y se la saca del
móvil. Por eso el flujo pide `featureType: "whatsapp_business_app_onboarding"`
(coexistencia) — quitar esa línea cambia el flujo por el destructivo.

Cosas que muerden y que ya están contempladas:

- **El código canjeable vive 30 segundos.** Se manda al servidor y se canjea en
  la misma petición. Si esto se mueve a una cola, deja de funcionar.
- **El orden es canjear → suscribir → guardar.** Guardar antes de suscribir
  dejaría al cliente «conectado» mandando mensajes y sin recibir nada, en
  silencio. Si algo falla a mitad, no se guarda y se puede reintentar.
- **No se puede conectar desde local**: `baseUrlWebhook` exige https y rechaza
  localhost. Esa URL se queda GUARDADA en Meta, y registrar `localhost:3000`
  como destino de los mensajes de un cliente real fallaría después y en
  silencio.
- El dominio del CRM tiene que estar en «Allowed domains» y «Valid OAuth
  redirect URIs» de la app de Meta, o el `postMessage` no llega y el botón dice
  que faltan datos.
- Variables: `NEXT_PUBLIC_META_APP_ID` y `NEXT_PUBLIC_META_CONFIG_ID` (públicas,
  van al navegador). Sin ellas el botón no aparece y queda el pegado a mano.

⚠️ **Nada de esto se puede probar de verdad hasta ser Tech Provider**: sin la
configuración de Embedded Signup no existe `config_id` y no hay ventana que
abrir. El código está escrito contra la documentación y probado con las
respuestas de Meta simuladas.

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
