# Módulo Citas — Embed de landing pública en WordPress

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `citas` · requiere — · este doc es el WIDGET público y el portal SSO de ese módulo: el mapa completo está en `citas.md`; aquí solo lo que toca a lo embebido |
| **Reina** | — · el widget y el portal se hicieron para `nutri_laura` (WordPress en tunutrilaura.com); el único snippet de WordPress escrito es el suyo |
| **Pantallas** | públicas, todas en `app/widget/c/[tenantSlug]/`: `page.jsx` → `/widget/c/<slug>` (reserva: tipo, día y hora), `book/page.jsx` → `/book`, `cancel/[token]/page.jsx`, `mi-perfil/page.jsx` (el portal «Mi perfil»; `/mis-citas` redirige ahí desde `next.config.mjs`), `pagar/[token]/page.jsx` (volver a meter la tarjeta); `layout.jsx` (marca del tenant, `robots: noindex`); las puertas y hooks en `_components/` (`AuthGate.jsx` con `useWidgetAuth`, `useCitasPortalSession.js`, `useAdmision.js`, `PuertaScreen`, `BienvenidaGate`, `ContratoGate`, `ContratoFormulario`, `DatosGate`, `ComunicacionesGate`, `ConsentimientoImagenGate`, `MisDocumentos`, `PasoTarjeta`, `SignaturePad`). `soporte/*` es del módulo Soporte |
| **Endpoints** | `app/api/public/c/[tenantSlug]/` (sin JWT, rate-limited): agenda anónima `info`, `event-types`, `availability` (+`month`), `book`, `booking/[token]`, `cancel/[token]`, `pagar/[token]` (8); portal con `Authorization: Bearer` bajo `citas-portal/` (13; la lista completa en `citas.md`) · La CSP `frame-ancestors` la pone `middleware.js` (`applyWidgetCspHeaders`: por tenant desde `WIDGET_FRAME_ANCESTORS`; sin entrada, `*`) |
| **Lógica** | `lib/citas/ssoToken.js` (verifica el `wpsso` que firma WordPress; acepta una lista de secretos para rotar), `portalSession.js` (el `sessionToken` del CRM), `portalRateLimit.js`, `quienPregunta.js` (¿anónimo o con sesión?), `puertaIdentidad.js` / `puertaFormulario.js` / `puertaContrato.js` / `puertaValoracion.js` / `puertaReserva.js` (lo que `/book` corta), `tiposVisibles.js`, `slots.js`, `cancelBooking.js`, `clientBookingSerializer.js`, `portalContract.js`, `portalDocumentos.js`, `portalClient.js`, `bienvenida.js`, `tokenPago.js`; el contexto de tenant sin JWT es `lib/tenant/publicTenantContext.js` |
| **UI** | todo vive dentro de `app/widget/c/[tenantSlug]/` (arriba); no usa `modules/` ni `components/`. El snippet de WordPress: `docs/modules/citas-portal-wordpress-snippet.php` (shortcodes `[crm_reservar_cita]` y `[crm_mis_citas]`, `crm_render_iframe`) |
| **Modelos** | los de `citas.md`; aquí se leen `EventType`, `Availability`, `Booking`, `SessionPack`, `ClientNotice`, `ContractTemplate`, `ContractSignature` y `Client` |
| **Interruptores y parámetros** | `featureFlags.autoConfirmPublicBookings` (`book/route.js`). En `tenant.settings`: `widget.sso.enabled` (abre `citas-portal/*`; lo leen esas rutas y `lib/citas/portalContract.js`), `widget.auth.required` / `.loginUrl` (legado, `lib/citas/puertaIdentidad.js`), y las puertas de `settings.citas.*` (`identidadObligatoria`, `formularioObligatorio`, `contratoObligatorio`, `soloConPago`, `reservaOnlineCerrada`; ver `citas.md`). Entorno: `WIDGET_SSO_SECRETS` (JSON slug → secreto o lista), `CITAS_PORTAL_SESSION_SECRET`, `WIDGET_FRAME_ANCESTORS` |
| **Pantallas propias** | ninguna: el widget es el mismo para todos y cambia por `settings` |
| **Scripts** | `configure-portal-citas.js <slug>` (enciende `widget.sso`; sustituye a `configure-nutri-laura-citas-portal.js`, que sigue en disco), `configure-nutri-laura-widget-auth.js` (el gate `?wpa=1`, legado), `dev-mint-wpsso.js <slug> <email>` (fabrica un `wpsso` de prueba sin WordPress), `comprobar-citas.js` (solo lectura: Stripe, Resend, precios y salas; NO mira los secretos del SSO) |
| **Pruebas** | En `npm test` (sin base ni servidor): `_smoke-puerta-identidad.mjs`, `_smoke-tipos-visibles.mjs`, `_smoke-tipos-ocultos.mjs`, `_smoke-bienvenida.mjs`. Con base de datos y `npm run dev` (`npm run test:todo`): `_smoke-puerta-formulario.mjs`, `_smoke-puerta-valoracion.mjs`, `_smoke-valoracion-inicial.mjs`, `_smoke-avisos-cliente.mjs`, `_smoke-book-autorizacion.mjs`, `_smoke-pedir-tarjeta.mjs`, `_smoke-webhook-retencion.mjs` (montan la sesión con `lib/citas/portalSession.js` y pegan a `/api/public/c/…`) |
| **Decisiones** | — (las del módulo, en `citas.md`) |
| **En este doc** | Qué es · Endpoints públicos que consume · Snippet para WordPress (Sprint 1) · Portal "Mis citas" (SSO WordPress) — Sprint 2 · TODO Sprint 2 · Verificación manual rápida |

> **Histórico:** este doc nació como «Sprint 1 (landing pública)» el 2026-05-29 y
> decía «reemplázalo cuando lleguen emails de Resend y restricción de dominio». Las
> dos cosas llegaron —10 plantillas en `lib/email/templates/citas/` y CSP por tenant
> con `WIDGET_FRAME_ANCESTORS`— y después el portal SSO, las puertas y el cobro. Las
> secciones de abajo conservan la cronología (Sprint 1 → Sprint 2) con lo que ha
> cambiado anotado; lo vigente está en el `## Mapa` y en `citas.md`.

## Qué es

La landing pública del módulo Citas vive **dentro del CRM Next.js** bajo
`/widget/c/{tenantSlug}`. Empezó como un mini-flujo de 3 vistas y hoy son cinco:

- `/widget/c/{tenantSlug}` — pantalla 1: seleccionar tipo de cita + día + hora.
- `/widget/c/{tenantSlug}/book?eventTypeId=…&datetime=…` — pantalla 2: datos
  del cliente + confirmación inline (y, si el tipo tiene precio, el formulario de
  tarjeta; si es un bono, salta a Stripe Checkout).
- `/widget/c/{tenantSlug}/cancel/{token}` — cancelar una cita desde un enlace.
- `/widget/c/{tenantSlug}/mi-perfil` — el portal de la familia con sesión SSO
  (Sprint 2, abajo). `/mis-citas` fue su primer nombre y **redirige** ahí
  (`next.config.mjs`).
- `/widget/c/{tenantSlug}/pagar/{token}` — volver a meter la tarjeta cuando la
  profesional la pide otra vez (ver `pagos.md`).

Se embebe en cualquier web del cliente (WordPress, etc.) vía `<iframe>`.

## Endpoints públicos que consume

Todos bajo `/api/public/c/{tenantSlug}/*` (sin JWT):

| Método | Ruta                                                            | Devuelve                                  |
| ------ | --------------------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/public/c/{slug}/info`                                     | Nombre + brand del tenant                 |
| GET    | `/api/public/c/{slug}/event-types`                              | EventType activos con modalidad `online`  |
| GET    | `/api/public/c/{slug}/availability?eventTypeId=…&date=…`        | Slots libres de un día                    |
| GET    | `/api/public/c/{slug}/availability/month?eventTypeId=…&year=…&month=…` | Días del mes con al menos 1 slot   |
| POST   | `/api/public/c/{slug}/book`                                     | Crea Booking (modalidad `online` fija). Antes pasa las PUERTAS (identidad, admisión, contrato, tipos visibles, `reservaOnlineCerrada`, `soloConPago`) y, con precio, deja la retención preparada |
| GET    | `/api/public/c/{slug}/booking/{token}`                          | Datos mínimos para mostrar en cancelación |
| POST   | `/api/public/c/{slug}/cancel/{token}`                           | Cancela el Booking                        |
| GET    | `/api/public/c/{slug}/pagar/{token}`                            | Lo que necesita `/pagar/{token}`: servicio, hora, importe y `clientSecret` de la retención nueva |

Todos validan que el tenant existe, que el módulo `citas` está activo y, en
los endpoints que tocan EventType, que el EventType tiene `online` en
`modalities`. Además de estos ocho, el portal con sesión añade trece bajo
`citas-portal/` (Sprint 2, abajo).

Si el tenant o el módulo no existen → **404**.

## Snippet para WordPress (Sprint 1)

Para la web de Laura (https://tunutrilaura.com), pegar este snippet en un
bloque "HTML personalizado" / "Custom HTML" en la página donde quiera el
widget de reservas:

```html
<!-- Widget de reservas — Nutri Laura (Salamandra CRM) -->
<div style="position: relative; width: 100%; max-width: 1200px; margin: 0 auto;">
  <iframe
    src="https://crm.salamandrasolutions.com/widget/c/nutri_laura"
    style="width: 100%; min-height: 820px; border: 0; display: block;"
    title="Reserva tu cita"
    loading="lazy"
  ></iframe>
</div>
<!-- Fin del widget -->
```

Notas para Laura:

1. La altura `min-height: 820px` es estática: si el contenido crece (mes con
   muchas filas, listas largas de slots), aparecerá un scroll **dentro** del
   iframe. En Sprint 2 evaluamos `postMessage` para altura dinámica.
2. El iframe es `loading="lazy"`: solo carga cuando entra en viewport. Si lo
   pones above-the-fold (al principio de la página) puedes quitar ese atributo.
3. El `meetUrl` de cada tipo de cita se configura desde el CRM (`Citas →
   Tipos de cita`). **Histórico:** en Sprint 1 era una sala permanente de
   Google Meet compartida por todas las reservas. Hoy el modo por defecto es
   **manual** (`lib/citas/videollamada.js`, `settings.citas.meetModo`): la cita
   nace sin enlace y la profesional lo pega y lo envía con «Guardar y enviar»;
   el modo «automático» es el que hereda la sala fija del tipo.

## CSP `frame-ancestors`: por tenant

El middleware (`middleware.js`, `applyWidgetCspHeaders`) añade en rutas
`/widget/c/*` la cabecera `Content-Security-Policy: frame-ancestors …`. Los
dominios permitidos salen de la variable de entorno **`WIDGET_FRAME_ANCESTORS`**,
un JSON `{ slug: "https://dominio.com https://www.dominio.com" }` (va en el
entorno porque el middleware corre antes que la base de datos). Con entrada, el
valor es `'self' <dominios>`; **un tenant SIN entrada sigue con `*`**, así que
encenderlo no rompe a nadie y se va cerrando cliente a cliente según confirman su
dominio.

**Histórico (Sprint 1):** era `frame-ancestors *` para todos — práctico mientras
se probaba con Laura, inseguro como estado final: cualquier web podía incrustar
la landing y hacerse pasar por el centro ante sus pacientes.

## Portal "Mis citas" (SSO WordPress) — Sprint 2

Segunda página embebible donde el cliente **logueado en la web de Laura** ve
**sus** citas (próximas + historial) y cancela las futuras; desde entonces ha
crecido y se llama «Mi perfil»: contrato, datos, documentos, avisos, comunicaciones y
consentimiento de imagen (las puertas están en `citas.md`). Aquí hace falta
**identidad**: qué citas mostrar depende de quién eres. El widget de reserva
era anónimo; **`?wpa=1` nunca fue identidad** (lo pone quien abre la URL y el
servidor no lo miraba) y desde el 05/08/2026 ya no prueba nada: lo único que
cuenta es la sesión de portal, también para reservar si el centro enciende
`identidadObligatoria` (ver «Puerta de identidad» en `citas.md`).

### Ruta y flujo

- Página: `/widget/c/{tenantSlug}/mi-perfil` (hereda el `layout.jsx` del widget).
  Nació como `/mis-citas`; esa URL sigue funcionando como redirect permanente
  (`next.config.mjs`) porque está enlazada desde la web y en correos ya enviados.
- **SSO por doble token** (patrón OAuth "code → access token"), porque el iframe
  es cross-origin y **no se pueden usar cookies** (Chrome/Safari bloquean cookies
  de terceros):

  | Token | Lo firma | Payload | TTL | Dónde viaja | Secreto |
  | --- | --- | --- | --- | --- | --- |
  | `wpsso` (handoff) | WordPress | `{ email, tenant, iat, exp }` | ~5 min | URL del iframe `?wpsso=…` | `WIDGET_SSO_SECRETS[slug]` (compartido con WP) |
  | `sessionToken` (sesión CRM) | CRM | `{ email, tenant, scope:"citas-portal", iat, exp }` | ~60 min | header `Authorization: Bearer`, en `sessionStorage` | `CITAS_PORTAL_SESSION_SECRET` (propio del CRM) |

  El frontend canjea el `wpsso` (una vez) por el `sessionToken` en `POST /session`,
  guarda el `sessionToken` en `sessionStorage` y limpia el `wpsso` de la URL. Todos
  los tokens son JWT **HS256** verificados con `algorithms:["HS256"]`.

### Endpoints del portal (bajo `/api/public/c/{slug}/citas-portal/`)

Todos requieren módulo `citas` activo **y** `tenant.settings.widget.sso.enabled === true` (si no → 403).

Los tres del Sprint 2:

| Método | Ruta | Auth | Devuelve |
| ------ | ---- | ---- | -------- |
| POST | `/citas-portal/session` | body `{ wpsso }` | `{ sessionToken, expiresInSeconds }`. 401 wpsso inválido · 403 SSO off/secreto ausente · 429 (10/min por IP) |
| GET | `/citas-portal/bookings` | `Authorization: Bearer` | `{ upcoming:[…], history:[…] }` (citas del email de la sesión) |
| POST | `/citas-portal/cancel/{id}` | `Authorization: Bearer` | `{ ok:true }`. **Ownership**: si el id no existe o es de otro email → **404** (no 403). 410 si ya cancelada/pasada |

La cancelación reutiliza `lib/citas/cancelBooking.js` (compartido con `cancel/{token}`).

Y los diez que vinieron después, todos con `Authorization: Bearer` (su detalle
en la tabla «Portal de la familia» de `citas.md`): `admision` (GET: ¿puede
reservar ya?), `avisos` (GET/POST), `comunicaciones` (GET/POST),
`consentimiento-imagen` (GET/POST), `mis-datos` (GET/POST), `documents`
(GET/POST) y `documents/{id}` (GET), `contract` (GET), `contract/sign` (POST)
y `contract/documento` (GET). Trece en total.

### Puesta en marcha (checklist)

1. **Activar el flag** por tenant:
   `docker exec crm-salamandra-app-1 node scripts/configure-portal-citas.js <slug>`
   (acepta `--sin-cancelacion`, `--sin-reserva`, `--apagar`, `--dry-run`; sustituye
   a `configure-nutri-laura-citas-portal.js`, que tenía el slug a fuego y sigue en
   disco).
2. **Secretos en `.env.production`** del VPS (regla #15, generar con `openssl rand -hex 32`):
   `WIDGET_SSO_SECRETS='{"nutri_laura":"<hex>"}'` y `CITAS_PORTAL_SESSION_SECRET='<otro hex>'`.

   > **Para ROTAR el de WordPress sin cortar el portal** (12/08/2026), el valor
   > acepta una LISTA: valen todos para verificar y se firma con el primero.
   > Se pone el nuevo delante —`{"nutri_laura":["<nuevo>","<viejo>"]}`— y se
   > despliega; se cambia `CRM_WIDGET_SSO_SECRET` en WordPress con calma; y en
   > el siguiente despliegue se quita el viejo. Antes había que cambiar las dos
   > puntas al mismo segundo y eso ya costó un corte.
3. **WordPress**: pegar el snippet de `docs/modules/citas-portal-wordpress-snippet.php`
   (Code Snippets tipo PHP o mu-plugin — se guarda en BD, sobrevive a cambios de tema),
   definir `CRM_WIDGET_SSO_SECRET` (en `wp-config.php` o en el propio snippet) con el
   **mismo** valor de `WIDGET_SSO_SECRETS[nutri_laura]`, y colocar los shortcodes:
   - `[crm_reservar_cita]` en la página de reservas.
   - `[crm_mis_citas]` en la página de "mis citas".

   Ambos shortcodes **exigen login**: si el usuario no está logueado muestran un aviso
   con botón a `CRM_LOGIN_URL` (`https://tunutrilaura.com/login/`); si lo está, cargan el
   iframe pasando el email firmado en `?wpsso=`.

### Reserva con login + email autorrellenado

El shortcode `[crm_reservar_cita]` pasa `?wpa=1&wpsso=<token>` al widget de reserva. Lo
que importa es el **`wpsso`**: el widget lo canjea por una sesión de portal (mismo
mecanismo que "Mi perfil") y con ella **pre-rellena y bloquea** el campo de email del
formulario con el email de la cuenta de WordPress. Al confirmar, el frontend envía el
`sessionToken` en `Authorization: Bearer` y el endpoint `POST /book` **fuerza** ese email
verificado (ignora el del body). Así la cita queda ligada a la cuenta del cliente y
aparece automáticamente en su "Mi perfil". `?wpa=1` se conserva solo como apaño de
pantalla (`useWidgetAuth`) para webs que lo pasen sin pasar la sesión; desde el
05/08/2026 no abre nada por sí solo.

> El embed plano de la sección "Snippet para WordPress (Sprint 1)" queda **superado** por
> `[crm_reservar_cita]` para tenants con SSO: no exige login ni autorrellena el email.

### Snippet HTML (si se embebe manualmente en vez del shortcode)

El shortcode `[crm_mis_citas]` ya genera el `<iframe>` con el `wpsso`. Solo si se
prefiere control manual, el iframe apunta a
`https://crm.salamandrasolutions.com/widget/c/nutri_laura/mi-perfil?wpsso=<token>`
(la ruta vieja `/mis-citas` redirige; el `<token>` lo debe generar WordPress
server-side; **no** hardcodear).

### Prueba en local (sin WordPress)

```powershell
# 1. Activar flag + poner ambos secretos en .env.local
node --env-file=.env.local scripts/configure-portal-citas.js nutri_laura

# 2. Generar un wpsso de prueba (imprime la URL del iframe)
node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com
#    (--expired para probar la expiración)
```

## TODO Sprint 2

Revisado el 19/08/2026:

- [x] Restringir `frame-ancestors`: hecho por tenant con `WIDGET_FRAME_ANCESTORS`
  (ver «CSP `frame-ancestors`: por tenant»); no se edita código, se añade la entrada
  del cliente en el entorno.
- [x] Emails de confirmación al cliente con el enlace de cancelación: hechos
  (`bookingConfirmed`, `bookingReceived`, `bookingRejected`, `bookingCancelled`,
  `bookingReminder`… en `lib/email/templates/citas/`; ver `emails.md`). La clave de
  Resend es del cliente (BYOK). A Laura le avisa la campana del CRM, no un correo.
- [ ] Integración Google Calendar / Meet — cada Booking genera su propio enlace
  único. Hoy hay dos modos (`lib/citas/videollamada.js`: manual por defecto,
  automático = sala fija del tipo) y «Añadir a Google Calendar»
  (`lib/citas/googleCalendar.js`), pero nadie crea salas llamando a Google.
- [ ] Altura dinámica del iframe vía `postMessage`. Sigue sin hacerse: el snippet
  pone `min-height` fijo y el scroll va dentro del iframe.
- [ ] Revisar si interesa exponer `/widget/c/{slug}` como public crawl
  (sigue con `robots: { index: false, follow: false }` en
  `app/widget/c/[tenantSlug]/layout.jsx`).

## Verificación manual rápida

```powershell
# 1. Tenant válido + módulo citas activo
curl.exe https://crm.salamandrasolutions.com/api/public/c/nutri_laura/info

# 2. Tipos de cita online
curl.exe https://crm.salamandrasolutions.com/api/public/c/nutri_laura/event-types

# 3. Slots de un día concreto (sustituir ID y fecha)
curl.exe "https://crm.salamandrasolutions.com/api/public/c/nutri_laura/availability?eventTypeId=…&date=2026-06-02"

# 4. Días disponibles del mes
curl.exe "https://crm.salamandrasolutions.com/api/public/c/nutri_laura/availability/month?eventTypeId=…&year=2026&month=6"
```
