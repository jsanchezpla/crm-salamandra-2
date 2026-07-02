# Módulo Citas — Embed de landing pública en WordPress

> **Sprint 1 (landing pública)** — generado 2026-05-29.
> Reemplaza este doc con la versión Sprint 2 cuando lleguen emails de Resend
> y restricción de dominio.

## Qué es

La landing pública del módulo Citas vive **dentro del CRM Next.js** bajo
`/widget/c/{tenantSlug}`. Es un mini-flujo de 3 vistas:

- `/widget/c/{tenantSlug}` — pantalla 1: seleccionar tipo de cita + día + hora.
- `/widget/c/{tenantSlug}/book?eventTypeId=…&datetime=…` — pantalla 2: datos
  del cliente + confirmación inline.
- `/widget/c/{tenantSlug}/cancel/{token}` — cancelar una cita desde un enlace.

Se embebe en cualquier web del cliente (WordPress, etc.) vía `<iframe>`.

## Endpoints públicos que consume

Todos bajo `/api/public/c/{tenantSlug}/*` (sin JWT):

| Método | Ruta                                                            | Devuelve                                  |
| ------ | --------------------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/public/c/{slug}/info`                                     | Nombre + brand del tenant                 |
| GET    | `/api/public/c/{slug}/event-types`                              | EventType activos con modalidad `online`  |
| GET    | `/api/public/c/{slug}/availability?eventTypeId=…&date=…`        | Slots libres de un día                    |
| GET    | `/api/public/c/{slug}/availability/month?eventTypeId=…&year=…&month=…` | Días del mes con al menos 1 slot   |
| POST   | `/api/public/c/{slug}/book`                                     | Crea Booking (modalidad `online` fija)    |
| GET    | `/api/public/c/{slug}/booking/{token}`                          | Datos mínimos para mostrar en cancelación |
| POST   | `/api/public/c/{slug}/cancel/{token}`                           | Cancela el Booking                        |

Todos validan que el tenant existe, que el módulo `citas` está activo y, en
los endpoints que tocan EventType, que el EventType tiene `online` en
`modalities`.

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
   Tipos de cita`). En Sprint 1 es una sala permanente de Google Meet —
   todas las reservas comparten la misma URL.

## Sprint 1: CSP `frame-ancestors *`

El middleware (`middleware.js`) añade en rutas `/widget/c/*`:

```
Content-Security-Policy: frame-ancestors *
```

Esto permite embeber la landing desde **cualquier dominio**. Es práctico en
Sprint 1 mientras probamos con Laura, pero **inseguro como estado final**:
cualquier web podría incrustar tu landing.

## Portal "Mis citas" (SSO WordPress) — Sprint 2

Segunda página embebible donde el cliente **logueado en la web de Laura** ve
**sus** citas (próximas + historial) y cancela las futuras. A diferencia del
widget de reserva (anónimo, gate `?wpa=1` sin firma), aquí hace falta **identidad**:
qué citas mostrar depende de quién eres.

### Ruta y flujo

- Página: `/widget/c/{tenantSlug}/mis-citas` (hereda el `layout.jsx` del widget).
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

### Endpoints nuevos (bajo `/api/public/c/{slug}/citas-portal/`)

Todos requieren módulo `citas` activo **y** `tenant.settings.widget.sso.enabled === true` (si no → 403).

| Método | Ruta | Auth | Devuelve |
| ------ | ---- | ---- | -------- |
| POST | `/citas-portal/session` | body `{ wpsso }` | `{ sessionToken, expiresInSeconds }`. 401 wpsso inválido · 403 SSO off/secreto ausente · 429 (10/min por IP) |
| GET | `/citas-portal/bookings` | `Authorization: Bearer` | `{ upcoming:[…], history:[…] }` (citas del email de la sesión) |
| POST | `/citas-portal/cancel/{id}` | `Authorization: Bearer` | `{ ok:true }`. **Ownership**: si el id no existe o es de otro email → **404** (no 403). 410 si ya cancelada/pasada |

La cancelación reutiliza `lib/citas/cancelBooking.js` (compartido con `cancel/{token}`).

### Puesta en marcha (checklist)

1. **Activar el flag** por tenant:
   `docker compose exec app node scripts/configure-nutri-laura-citas-portal.js`
2. **Secretos en `.env.production`** del VPS (regla #14, generar con `openssl rand -hex 32`):
   `WIDGET_SSO_SECRETS='{"nutri_laura":"<hex>"}'` y `CITAS_PORTAL_SESSION_SECRET='<otro hex>'`.
3. **WordPress**: pegar el snippet de `docs/modules/citas-portal-wordpress-snippet.php`
   (mu-plugin o functions.php), definir `CRM_WIDGET_SSO_SECRET` en `wp-config.php`
   con el **mismo** valor de `WIDGET_SSO_SECRETS[nutri_laura]`, y colocar el shortcode
   `[crm_mis_citas]` en una página protegida para usuarios logueados.

### Snippet HTML (si se embebe manualmente en vez del shortcode)

El shortcode `[crm_mis_citas]` ya genera el `<iframe>` con el `wpsso`. Solo si se
prefiere control manual, el iframe apunta a
`https://crm.salamandrasolutions.com/widget/c/nutri_laura/mis-citas?wpsso=<token>`
(el `<token>` lo debe generar WordPress server-side; **no** hardcodear).

### Prueba en local (sin WordPress)

```powershell
# 1. Activar flag + poner ambos secretos en .env.local
node --env-file=.env.local scripts/configure-nutri-laura-citas-portal.js

# 2. Generar un wpsso de prueba (imprime la URL del iframe)
node --env-file=.env.local scripts/dev-mint-wpsso.js nutri_laura test@x.com
#    (--expired para probar la expiración)
```

## TODO Sprint 2

- [ ] Restringir `frame-ancestors` a `https://tunutrilaura.com
  https://www.tunutrilaura.com` (y subdominios de prueba si aplica). Editar
  `applyWidgetCspHeaders()` en `middleware.js`.
- [ ] Emails de confirmación (Resend o similar) al cliente y a Laura,
  incluyendo el enlace de cancelación (`/widget/c/{slug}/cancel/{token}`).
- [ ] Integración Google Calendar / Meet — cada Booking genera su propio
  enlace único en lugar de usar la sala permanente del EventType.
- [ ] Altura dinámica del iframe vía `postMessage`. El widget enviaría su
  altura tras cada render y el snippet de WordPress ajustaría el `height`.
- [ ] Revisar si interesa exponer `/widget/c/{slug}` como public crawl
  (hoy lleva `robots: noindex,nofollow` desde `app/widget/c/[tenantSlug]/layout.jsx`).

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
