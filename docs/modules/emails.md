# Emails transaccionales

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | sin moduleKey: es infraestructura transversal y la tienen todos. Quien la usa hoy: `citas`, `billing`, `formularios`, `nutricion`, `outreach`, `support` (también el correo ENTRANTE), `configuracion` y el Buzón (`docs/modules/buzon.md`) |
| **Reina** | — |
| **Pantallas** | ninguna propia. Las claves se pegan en Configuración → tarjeta «Resend» (`app/(dashboard)/configuracion/page.jsx` → `/configuracion`, `modules/config/ConfigModule.jsx`; es UNIVERSAL, regla #14: sale en todos los clientes usen o no correo). El back-office `/admin` (`app/admin/page.jsx`) enseña el remitente de cada cliente vía `app/api/admin/configuraciones/route.js` |
| **Endpoints** | ninguno de envío propio: `sendEmail` se llama DESDE los módulos — `app/api/citas/bookings/route.js`, `bookings/[id]/route.js` (+`confirm`, `reject`, `pedir-tarjeta`), `citas/avisos`, `billing/invoices/[id]/send`, `formularios/[id]/accept`, `nutricion/plans/[id]/send-email`, `outreach/leads/[id]/enviar-correo`, `outreach/leads/buscar-nuevos`, `tickets/[id]/messages`, y los públicos `public/c/[tenantSlug]/book` y `public/c/[tenantSlug]/formularios/[formSlug]` · Guardar las claves: `app/api/tenant/settings/route.js` · **Webhook ENTRANTE**: `app/api/webhooks/resend-inbound/route.js` (Soporte: `soporte-<slug>@RESEND_INBOUND_DOMAIN`, firmado con `RESEND_WEBHOOK_SECRET`; en producción aún sin dar de alta en Resend) |
| **Lógica** | `lib/email/resendClient.js` (`sendEmail`: nunca lanza, dry-run sin clave, 1 reintento en 5xx; `envioRealizado`: traduce la respuesta a `{salio, motivo}`) · `lib/email/templates/layout.js` (`renderLayout`, HTML de tablas con la marca del tenant) · `lib/outreach/resendConfig.js` (`getTenantResendConfig`: la clave POR CLIENTE —BYOK— desde `settings.integrations`, descifrada con `lib/crypto/secretBox.js`; from/reply-to con respaldo `OUTREACH_FROM_EMAIL`/`OUTREACH_REPLY_TO`) · `lib/demo/isDemo.js` (guard obligatorio en todo endpoint del dashboard que envíe) · envíos que viven en `lib/`: `lib/citas/recordatorios.js`, `lib/citas/notificarCancelacion.js`, `lib/payments/entityHooks.js`, `lib/support/notify.js`, `lib/buzon/avisarPorCorreo.js`, `lib/configuracion/avisoCambio.js` |
| **UI** | `modules/config/ConfigModule.jsx` (tarjeta Resend: clave, remitente, reply-to). No hay `modules/email/` ni `components/email/`; las plantillas son HTML de servidor |
| **Modelos** | ninguno propio: no hay `email_send_log` (sigue en «Pendientes para producción»); lo único que queda escrito es lo que cada módulo apunte (`bookings.reminder_sent_at`, `client_notices.email_status`…) y la salida por stdout/stderr |
| **Interruptores y parámetros** | ninguno que lea el código en `featureFlags`/`logicOverrides`. Por cliente, en `tenant.settings.integrations`: `resendApiKey` (cifrada en reposo), `resendFromEmail`, `resendReplyTo`. Entorno: `RESEND_API_KEY` y `RESEND_FROM_EMAIL` (el respaldo GLOBAL de `sendEmail`; en producción la clave va vacía a propósito, así que sin clave del cliente el envío es dry-run), `OUTREACH_FROM_EMAIL`, `OUTREACH_REPLY_TO`, `RESEND_INBOUND_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `APP_PUBLIC_URL` (los enlaces del recordatorio, en `scripts/enviar-recordatorios.js`) |
| **Pantallas propias** | ninguna |
| **Scripts** | Diagnóstico (solo lectura): `check-resend-tenant.mjs <slug>` (la clave del CLIENTE: dominios y estado, sin imprimirla), `check-resend.mjs` (la del entorno), `comprobar-citas.js` (dice si a un cliente le falta clave o remitente) · `_hechos/encrypt-tenant-secrets.js` (cifra en reposo las claves ya guardadas, `resendApiKey` incluida) · Cron: `enviar-recordatorios.js` (`scripts/deploy/crm-recordatorios.timer`, cada hora) |
| **Pruebas** | En `npm test`: `scripts/_smoke-plantillas-resto-layout.mjs` (`node:test`, 21/08/2026, ligera; 111 comprobaciones) sobre `lib/email/templates/layout.js` —que lo usan TODAS— y las **seis plantillas que no son de citas** (`billing/invoiceSent`, `buzon/avisoNuevo`, `configuracion/cambioAplicado`, `nutricion/menuEmail`, `soporte/ticketClient`, `soporte/ticketTeam`). Fija lo que DEVUELVEN: que un tenant sin `settings.brand` (los recién dados de alta) recibe el correo entero con la paleta Salamandra y no un `style="background:undefined"`, que `safeColor` no deja que un «color» guardado a mano se salga del `style="…"` y se convierta en HTML (dos inyecciones reales), que el `html` y el `text` dicen lo mismo, que cada condicional («si no hay vencimiento», «si no hay credenciales», «si no hay respuesta»…) se apaga en las DOS versiones, y que un nombre con `<` sale escapado. Seis rarezas cosméticas quedan fijadas tal cual con `it` marcados `// SOSPECHOSO`. · Las **diez plantillas de `templates/citas/`** las cubren `scripts/_smoke-plantillas-citas-reserva.mjs` (los cinco del ciclo de una cita: reserva recibida, confirmada, rechazada, cancelada y cambiada de fecha) y `scripts/_smoke-plantillas-citas-resto.mjs` (`bookingMeetLink`, `bookingReminder`, `pedirTarjeta`, `avisoCliente`, `solicitudAceptada`); las dos son de `node:test`, ligeras y del 21/08/2026, y **se documentan en `citas.md`**. Con esas tres, las **16 plantillas** del repo y el layout quedan cubiertas. · `_smoke-checkpoint2-emails.mjs` (las tres plantillas de citas en dry-run, sin base). Con base de datos: `_smoke-checkpoint2-e2e.mjs`; con base y `npm run dev` (`npm run test:todo`): `_smoke-correo-entrante.mjs` (el webhook entrante, con cuerpos firmados como los firma Resend), `_smoke-enlace-videollamada.mjs` (que «Guardar y enviar» no mienta), `_smoke-avisos-cliente.mjs` (el aviso se guarda aunque el correo no salga, y registra qué pasó con él) |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` (el guard de la demo en lo que envía correo: la demo es pública y salía por nuestro dominio) |
| **En este doc** | Resumen · Configuración · Templates disponibles · Layout compartido · Añadir un template nuevo · Errores y reintentos |

## Resumen

Envío de emails transaccionales con [Resend](https://resend.com).
Helper único en `lib/email/resendClient.js` + templates por módulo bajo
`lib/email/templates/{módulo}/`.

> ⚠️ **`sendEmail` NUNCA lanza. Hay que MIRAR lo que devuelve.**
> Devuelve `{ok:false, error}` si Resend rechaza y `{ok:true, dryRun:true}` si
> no hay correo configurado — en ninguno de los dos casos sale un email, y en
> ninguno de los dos se entera un `try/catch`. Si el caller **persiste** que
> se envió (`reminderSentAt`, `emailEnviado`, `status:"sent"`), tiene que
> comprobar `ok` y `dryRun` primero. En la auditoría del 2026-07-28 fallaban
> tres sitios a la vez: los recordatorios de cita se marcaban como avisados
> PARA SIEMPRE sin haber salido, y el envío de facturas devolvía
> `emailEnviado: true` con Resend rechazando. Lo grave no es que un correo
> falle: es que el sistema afirme que salió.
>
> ```js
> const r = await sendEmail({ ... });
> if (!r.ok || r.dryRun) { /* NO marcar como enviado */ }
> ```
>
> Y si el endpoint es alcanzable desde el dashboard, además necesita su guard
> de `lib/demo/isDemo.js` (la demo pública da sesión de admin a anónimos).

Estado actual (19/08/2026): **16 plantillas en 6 carpetas** de
`lib/email/templates/` — `citas/` (10), `billing/`, `buzon/`,
`configuracion/`, `nutricion/` (1 cada una) y `soporte/` (2) — más el correo
ENTRANTE de Soporte. La lista, abajo. **Histórico:** nació en el sprint Fase 1
de nutri_laura (junio 2026) con 3 plantillas de `citas`.

## Configuración

**La clave de Resend es DEL CLIENTE (BYOK)**, no del entorno. Cada cliente pega
la suya en Configuración → tarjeta «Resend» (`PATCH /api/tenant/settings`), y
queda en `tenant.settings.integrations`:

| Campo | Qué es |
| --- | --- |
| `resendApiKey` | su API key, **cifrada en reposo** (`lib/crypto/secretBox.js`, `SETTINGS_ENCRYPTION_KEY`); la API devuelve pistas enmascaradas, nunca en claro |
| `resendFromEmail` | remitente (de un dominio verificado en SU cuenta de Resend) |
| `resendReplyTo` | a dónde responde el paciente |

`lib/outreach/resendConfig.js` → `getTenantResendConfig(ctx)` la resuelve
(`{ apiKey, fromEmail, replyTo }`; `apiKey` es `null` si no la puso o no se
puede descifrar) y cada módulo se la pasa a `sendEmail` como `apiKey`, `from`
y `replyTo`. Así cada cliente manda desde su dominio, con su reputación y su
cupo, y el correo de una paciente de Laura no sale de nuestra cuenta.

Variables de entorno (`.env.production` / `.env.local`):

```
RESEND_API_KEY=            # respaldo GLOBAL de sendEmail. En producción va VACÍA a
                           # propósito: sin clave del cliente, el envío es dry-run
RESEND_FROM_EMAIL=         # remitente de respaldo de sendEmail
OUTREACH_FROM_EMAIL=       # from/reply-to por defecto que pone getTenantResendConfig
OUTREACH_REPLY_TO=         #   cuando el cliente no ha puesto los suyos (es NUESTRA
                           #   dirección: no usarla para escribirle a un paciente)
RESEND_INBOUND_DOMAIN=     # correo ENTRANTE de Soporte (soporte-<slug>@…)
RESEND_WEBHOOK_SECRET=     # firma svix del webhook entrante
```

`RESEND_INBOUND_DOMAIN` y `RESEND_WEBHOOK_SECRET` **aún no están dadas de alta
en producción** (el correo entrante de Soporte es tarea P2 del backlog).

> **Histórico:** hasta 07/2026 la clave era una sola, `RESEND_API_KEY` en
> `.env.production`, y el remitente `RESEND_FROM_EMAIL`. Eso significaba que
> todos los clientes mandaban desde nuestro dominio y con nuestro cupo — y que
> en producción, sin esa clave, llevó semanas en dry-run sin que nadie lo
> notara (ver «La campana avisa» en `citas.md`).

### Modo dry-run (no envía)

El helper hace **dry-run automático** cuando la clave que le llega —la
`apiKey` del cliente o, en su defecto, `RESEND_API_KEY`— está **ausente** o
vale exactamente `"dry-run"`. (La cabecera de `resendClient.js` decía además
que en no-producción una clave `re_test_…` forzaba dry-run: `isDryRun()`
nunca lo implementó; corregido el comentario el 19/08/2026.) En producción
`RESEND_API_KEY` va vacía a propósito, así que **un cliente sin clave propia
está en dry-run**: `comprobar-citas.js` y `check-resend-tenant.mjs` lo
cantan.

En dry-run, `sendEmail()` solo loguea por stdout:

```
[email:send:dry-run] to="..." from="..." subject="..." preview="..."
```

y devuelve `{ ok: true, dryRun: true, id: null }`. Útil para
desarrollo local y para smoke tests sin consumir quota.

### Modo live

Cuando hay clave (la del cliente, o `RESEND_API_KEY` si no) y no es
`"dry-run"`, el helper importa dinámicamente el paquete `resend` y hace el
envío real:

- Si el `from` resultante es el placeholder `no-reply@example.com` (ni
  `params.from` ni `RESEND_FROM_EMAIL`), aborta ANTES de tocar la red con
  `{ ok: false, error: "RESEND_FROM_EMAIL no configurado" }`: Resend
  respondería 403 seguro.
- 1 reintento con backoff 800 ms para errores 5xx transitorios.
- 4xx no reintentado.
- Si el paquete `resend` no está instalado (`npm install` no ejecutado),
  **cae a dry-run con warning** — no rompe la app. Esto da margen para
  desplegar el código sin la dependencia instalada en una sesión y
  hacer `npm install resend` después.

### Dar de alta el correo de un cliente (BYOK)

Resend exige verificar el dominio antes de enviar emails reales. Pasos, con
Laura (`tunutrilaura.com`) de ejemplo — los da el CLIENTE en su cuenta, y
nosotros no tocamos el VPS:

1. Crear cuenta en [resend.com](https://resend.com) (plan gratis 3000
   emails/mes).
2. Ir a Domains → Add Domain → `tunutrilaura.com`.
3. Añadir los registros DNS que Resend indica (SPF + DKIM + opcional
   DMARC). En Cloudflare/registrador, crear:
   - `TXT` para SPF.
   - `TXT` con prefijo `resend._domainkey` (DKIM).
   - (Recomendado) `TXT` `_dmarc` con `v=DMARC1; p=none; rua=mailto:...`.
4. Esperar verificación (suele ser <10 min en Cloudflare).
5. Generar API key en Resend → API Keys → Create.
6. Pegarla en el CRM: Configuración → tarjeta **Resend** (clave, remitente de
   ese dominio y reply-to). Queda cifrada en `settings.integrations`.
   > **Histórico:** antes se ponía `RESEND_API_KEY` y `RESEND_FROM_EMAIL` en
   > `.env.production` del VPS y se reiniciaba el contenedor. Ya no: la del
   > entorno va vacía a propósito.
7. Comprobar sin mandar nada: `docker exec crm-salamandra-app-1 node
   scripts/check-resend-tenant.mjs <slug>` (dominios y estado de SU clave, sin
   imprimirla) y `scripts/comprobar-citas.js <slug>`.
8. Smoke test: hacer una reserva desde la web — el email debe llegar
   al inbox del paciente. Si va a spam, verificar SPF/DKIM con
   [mail-tester.com](https://www.mail-tester.com/).

## Templates disponibles

### Citas

Ubicación: `lib/email/templates/citas/`.

| Template | Subject | Cuándo se dispara |
|---|---|---|
| `bookingReceived` | "Hemos recibido tu solicitud de cita" | `POST /api/public/c/[slug]/book` con `autoConfirmPublicBookings=false` (lista de espera). El paciente recibe ack inmediato. Con tarjeta de por medio sale desde el webhook (`lib/payments/entityHooks.js`), cuando el dinero queda retenido. |
| `bookingConfirmed` | "Tu cita está confirmada" | (a) `POST /book` con `autoConfirmPublicBookings=true` (auto-confirm directo). (b) `PATCH /api/citas/bookings/[id]/confirm` (Laura confirma desde lista de espera). Dice si se cobró o no. |
| `bookingRejected` | "Sobre tu solicitud de cita" | `PATCH /api/citas/bookings/[id]/reject`. Email educado con motivo opcional. |
| `bookingCancelled` | "Tu cita ha sido cancelada" | Cancela el CENTRO una cita futura. Lo monta y lo manda UN solo sitio, `emailCancelacionAlCliente` (`lib/citas/notificarCancelacion.js`); lo disparan el PATCH/DELETE de `bookings/[id]` (el panel), `lib/citas/cancelBooking.js` y `lib/clients/borrarRastro.js` (al borrar una ficha). Hasta el 21/08/2026 el panel guardaba su propia copia y esta fila se leía como si fueran dos. Si cancela el paciente, no se le escribe. |
| `bookingRescheduled` | "Han cambiado la fecha de tu cita" | PATCH de `bookings/[id]` que mueve la hora; enseña las DOS fechas (03/08). |
| `bookingMeetLink` | "Enlace para tu videollamada" | «Guardar y enviar» del enlace de videollamada (PATCH `bookings/[id]`). |
| `bookingReminder` | "Recordatorio: tu cita es mañana a las HH:MM" | `scripts/enviar-recordatorios.js` cada hora (`lib/citas/recordatorios.js`), solo si `settings.citas.recordatorios`; siempre con el enlace de cancelación. |
| `avisoCliente` | el título que escriba el centro | `POST /api/citas/avisos`: el aviso sale por correo Y queda en el portal. |
| `pedirTarjeta` | "Necesitamos tu tarjeta otra vez para tu cita" | `POST /api/citas/bookings/[id]/pedir-tarjeta` (ver `pagos.md`). |
| `solicitudAceptada` | "Ya puedes pedir tu cita — …" / "Hemos aceptado tu solicitud — …" (si la reserva online está cerrada) | `PATCH /api/formularios/[id]/accept` (módulo Leads Comerciales). |

Los tres primeros son los de la Fase 1; el resto llegó entre el 27/07 y el
13/08/2026. Todos salen con la clave de Resend del cliente. Miran
`citaPuedeAvisar` (las preferencias de comunicación de la familia,
`lib/clients/comunicaciones.js`): los de `/book` y `/confirm`,
`bookingRescheduled`, `bookingMeetLink`, `bookingReminder` y `avisoCliente`.
**No lo miran**: `bookingRejected`, `bookingCancelled`, `pedirTarjeta`,
`solicitudAceptada` y el `bookingReceived` que sale del webhook de Stripe.

⚠️ **El repaso de escapado del 10/08/2026 se cerró del todo el 21/08/2026.**
Aquel día se escaparon los datos que teclea una persona (motivo de cancelación,
enlace de videollamada, dirección) porque salen disparados al correo del
paciente desde el dominio verificado del centro. Quedó uno fuera: `pedirTarjeta.js`
metía el enlace de pago **crudo dentro del `href`** del botón, y era el único
`href="${…}"` sin escapar de todo `lib/email`. Ahí una comilla no rompe el
marcado, lo **amplía** (`" onmouseover="…`). Ya va escapado, y lo vigila
`_smoke-plantillas-citas-resto.mjs`. La versión de **texto plano** sigue sin
escapar a propósito: ahí no hay marcado que romper y escapar la haría ilegible.

### Otros módulos

| Carpeta / plantilla | Subject | Cuándo se dispara |
|---|---|---|
| `billing/invoiceSent` | "Factura N · Centro" | `POST /api/billing/invoices/[id]/send` — el PDF va como `attachments`. Con guard de demo. |
| `nutricion/menuEmail` | "Tu pauta nutricional — Centro" | `POST /api/nutricion/plans/[id]/send-email` — el menú en PDF como adjunto (la paciente no tiene dashboard). |
| `soporte/ticketClient` | "TK-0042 — Hemos recibido tu solicitud" / "Nueva respuesta…" / "Tu solicitud está resuelta" | `lib/support/notify.js`: al cliente del tenant, al abrir, responder y resolver. Reply-to = la captura del correo entrante. |
| `soporte/ticketTeam` | "TK-0042 — Nuevo ticket desde el portal" / "Ticket asignado a ti" / "El cliente ha respondido" | `lib/support/notify.js`: al equipo del tenant. |
| `buzon/avisoNuevo` (`avisoParaNosotros`) | "AV-0007 · Cliente: asunto" | `lib/buzon/avisarPorCorreo.js`: un cliente nos escribe desde `/ayuda` y nos llega A NOSOTROS (ver `buzon.md`). |
| `configuracion/cambioAplicado` | "Se ha modificado la configuración de tu cuenta" / "…credenciales de tu cuenta" | `lib/configuracion/avisoCambio.js`: recibo a los admin del cliente (`master.users`, nunca un campo del formulario) cada vez que cambia su configuración — desde su propia pantalla (`PATCH /api/tenant/settings`) o desde el back-office. **Sale con la cuenta de Resend de `salamandra_solutions`**, no con la del cliente: si no, se caería justo cuando lo que cambia es su clave de correo. |

### Correo ENTRANTE (Soporte)

`POST /api/webhooks/resend-inbound`: Resend recibe lo que llega a
`soporte-<slug>@RESEND_INBOUND_DOMAIN` y lo reenvía firmado (svix,
`RESEND_WEBHOOK_SECRET`). Se casa por nº de ticket en el asunto → remitente con
ticket activo → si nada casa, abre ticket nuevo. Detalle en `support.md`;
prueba en `scripts/_smoke-correo-entrante.mjs`. **En producción aún sin dar de
alta en Resend.**

### Diagrama lógico

(Las tres plantillas de la Fase 1. Con precio, la cita nace `pending` mande
lo que mande el flag, y el `bookingReceived` sale desde el webhook cuando la
tarjeta queda retenida; ver `pagos.md`.)

```
POST /book:
  ┌─ autoConfirm=true  → INSERT status=confirmed → sendEmail(bookingConfirmed) inmediato
  └─ autoConfirm=false → INSERT status=pending   → sendEmail(bookingReceived)
                                                       │
                                                       ▼
                                                Laura desde UI:
                                                       │
                            ┌──────────────────────────┼──────────────────────────┐
                            ▼                                                     ▼
                  PATCH /confirm                                          PATCH /reject
                  status=confirmed                                        status=cancelled
                  sendEmail(bookingConfirmed)                             sendEmail(bookingRejected)
```

## Layout compartido

`lib/email/templates/layout.js` exporta `renderLayout({...})` —
genera HTML tabla-based (compat Outlook clásico), 560 px max-width,
branded vía `Tenant.settings.brand`:

- `primaryColor` (barra superior, énfasis).
- `accent` (fondo de bloques de datos).
- `card` (fondo del contenedor principal).
- `text`, `muted` (texto + meta-texto).

Si el tenant no tiene `settings.brand` → defaults Salamandra
(`#1B3A2D`). Cada template puede sobreescribir lo que necesite.

Cada template devuelve `{ subject, html, text }` — `text` es fallback
plain-text para clientes que no renderizan HTML.

## Añadir un template nuevo

1. Crea `lib/email/templates/{módulo}/{nombre}.js`.
2. Exporta una función `{nombre}Template(ctx)` que devuelve
   `{ subject, html, text }`.
3. Reutiliza `renderLayout` del layout compartido y `escapeHtml` para
   datos del usuario.
4. En el endpoint que dispara el email:
   ```js
   import { sendEmail, envioRealizado } from "lib/email/resendClient.js";
   import { getTenantResendConfig } from "lib/outreach/resendConfig.js";
   import { isDemoTenant } from "lib/demo/isDemo.js";
   import { miTemplate } from "lib/email/templates/.../miTemplate.js";

   // Si el endpoint es alcanzable desde el dashboard: la demo es pública.
   if (isDemoTenant(ctx)) { /* no mandar; decirlo en la respuesta */ }

   let salio = false;
   try {
     const tpl = miTemplate({ tenantName: tenant.name, brand: tenant.settings?.brand, ...datos });
     const cfg = getTenantResendConfig(ctx);            // BYOK: la clave del cliente
     const r = await sendEmail({
       to, subject: tpl.subject, html: tpl.html, text: tpl.text,
       from: cfg.fromEmail || undefined,
       replyTo: cfg.replyTo || undefined,
       apiKey: cfg.apiKey || undefined,                 // sin ella → RESEND_API_KEY → dry-run
       // tags: [{ name: "modulo", value: "citas" }],  // opcional, para filtrar en Resend
       // attachments: [{ filename: "x.pdf", content: buffer }], // opcional (facturas, menús)
     });
     ({ salio } = envioRealizado(r, "modulo:accion")); // {salio, motivo: ok|sin_configurar|error}
   } catch (err) {
     process.stderr.write(`[modulo:accion] email fail: ${err.message}\n`);
   }
   // Solo si `salio` se persiste «enviado» o se le dice al usuario que salió.
   ```
5. **Envuelve siempre en `try/catch`** — un fallo de email NUNCA debe
   romper el flujo de negocio. Pero el `try/catch` **no basta**: `sendEmail`
   no lanza, así que hay que mirar `envioRealizado(r)` (o `r.ok && !r.dryRun`)
   antes de marcar nada como enviado (ver el aviso del Resumen).
6. Si el destinatario es una familia de un centro con Citas, mira antes
   `citaPuedeAvisar(tenantModels, booking, "citasEmail")`
   (`lib/clients/comunicaciones.js`): quien desmarcó esa casilla no recibe
   avisos de cita.
7. Si el endpoint es alcanzable desde el dashboard, necesita su guard de
   `lib/demo/isDemo.js` (`isDemoTenant`): la demo pública da sesión de admin a
   anónimos y sin él el CRM es un relé de correo.
8. Una prueba en `scripts/_smoke-*.mjs` que renderice la plantilla en dry-run
   (como `_smoke-checkpoint2-emails.mjs`), y una línea en este doc.

## Errores y reintentos

- 5xx (transitorio): 1 reintento con backoff 800 ms.
- 4xx (configuración, API key inválida, dominio no verificado, etc.):
  no reintenta — error definitivo.
- Cualquier excepción del helper → devuelve `{ ok: false, error }` y
  loguea `[email:send] ...` a stderr. El endpoint que lo llama loguea
  el contexto adicional con `[citas:confirm] email-confirmed fail: ...`.

### Pendientes para producción

- **Reintentos persistentes**: hoy es best-effort. Si Resend está caído
  cuando Laura confirma una cita, el email se pierde definitivamente.
  Solución futura: `email_send_log` con cola + reintentos vía n8n o
  job periódico. Apuntado al backlog.
- **Auditoría**: hoy los envíos solo se loguean por stdout. Pasarlos a
  `master.AuditLog` con `action="email.sent"` o tabla dedicada
  permitiría buscar "¿qué emails enviamos a {paciente} la semana
  pasada?".

---

## Escribir a mano, a mucha gente (24/08/2026)

Hasta hoy este documento describía **correo automático**: una factura, un
recordatorio, un aviso. Lo único parecido a escribir a alguien era el correo
modelo de Captación, y de uno en uno.

Rodrigo pidió el 24/08/2026 «poder enviar los correos desde el CRM también a la
gente, poder unir la cantidad de correos que quiera y elegir con qué correo
quiero mandar el mensaje». De ahí salen dos cosas nuevas.

### 1. Varios remitentes, no uno

`lib/email/remitentes.js`. Antes un cliente tenía UN remitente
(`integrations.resendFromEmail`), que basta para avisos automáticos porque
siempre salen «del centro». No basta para escribir a gente: la representante de
un artista escribe a un ayuntamiento desde `booking@`, a un medio desde
`prensa@`, y a veces desde su propia dirección porque quiere que le contesten a
ella.

- Se guardan en `settings.integrations.remitentes`: `[{id, nombre, email, replyTo}]`.
- **El `id` ES el correo** en minúsculas. No se generan UUID: la dirección ya es
  única, no cambia sola, y guardar dos veces la misma lista no duplica nada.
- **El primero es el de por defecto**, por orden. No hay un booleano
  `porDefecto` guardado, que se podría quedar en dos a la vez.
- **Compatibilidad**: si no hay lista, `listarRemitentes()` devuelve el
  `resendFromEmail` de siempre como remitente único. Nadie se queda sin poder
  mandar por no haber tocado una configuración que hasta hoy no existía.
- Los envíos automáticos que ya existían **no pasan por aquí**: siguen leyendo
  `getTenantResendConfig`. Este fichero es solo para el correo que escribe una
  persona.

`resolverRemitente(ctx, id)` devuelve `null` cuando el id pedido no está en la
lista, y quien llama responde 422. **Nunca cae al de por defecto**: mandar desde
una dirección que no era la pedida es peor que no mandar — puede acabar en la
bandeja equivocada de otra persona.

### 2. La pantalla `/correo`

`modules/correo/CorreoModule.jsx`. Sin `moduleKey` propio: se ve con `clients`
**o** `outreach` (`visibleModules` en el Sidebar, que es la misma condición que
comprueban los endpoints).

| Endpoint | Qué hace |
| --- | --- |
| `GET /api/correo/remitentes` | Las direcciones elegibles + `listo`/`motivo`. Existe aparte de `/api/tenant/settings` porque aquella es de ADMIN y quien escribe correos no tiene por qué serlo. |
| `GET /api/correo/destinatarios?fuente=` | Candidatos de UNA fuente: `contratantes` (`clients`), `contactos` (`contacts`), `propuestas` (`leads`), `captacion` (`outreach_leads`). Cada fuente exige SU módulo. |
| `POST /api/correo/envios` | El envío. |

Tres decisiones del envío que conviene no deshacer:

1. **Un correo POR destinatario**, nunca un «Para» con cien direcciones ni copia
   oculta. Lo primero enseñaría a cada ayuntamiento la lista de los demás
   —competidores incluidos— y es un problema de protección de datos; lo segundo
   va a spam mucho antes que cien correos normales, y aquí lo que se juega es
   que la propuesta se lea.
2. **Nunca revienta a medias.** Un fallo en el destinatario 12 no tira los 40
   restantes: se envían todos y se devuelve el desglose (`enviados`,
   `simulados`, `fallidos` con motivo, `invalidos`).
3. **El dry-run no miente.** `sendEmail` devuelve `{ok:true, dryRun:true}` sin
   clave, y eso ya hizo que una pantalla dijera «enviado» con el buzón vacío
   (03/08/2026, el enlace de la videollamada). Aquí el dry-run va en su propio
   contador, `simulados`, y la pantalla lo dice con todas las letras: «simulado
   no es enviado».

Topes: 200 destinatarios por envío, asunto 200 caracteres, cuerpo 20.000.
La auditoría (`correo.envio_masivo`) guarda remitente, asunto y recuentos —
**nunca el cuerpo**, que puede llevar datos de la persona.
