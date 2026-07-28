# Emails transaccionales

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

Estado actual: sprint Fase 1 nutri_laura (junio 2026) — 3 templates de
`citas`. El patrón es reutilizable para futuros módulos (billing,
training, etc.).

## Configuración

Variables de entorno en `.env.production` (y `.env.local` para dev):

```
RESEND_API_KEY=re_xxxxx_xxxxx_xxxxx     # obtener en resend.com
RESEND_FROM_EMAIL=hola@nutri-laura.es   # dominio verificado en Resend
```

### Modo dry-run (no envía)

El helper hace **dry-run automático** cuando:

- `RESEND_API_KEY` está **ausente**, o
- `RESEND_API_KEY === "dry-run"`.

En dry-run, `sendEmail()` solo loguea por stdout:

```
[email:send:dry-run] to="..." from="..." subject="..." preview="..."
```

y devuelve `{ ok: true, dryRun: true, id: null }`. Útil para
desarrollo local y para smoke tests sin consumir quota.

### Modo live

Cuando `RESEND_API_KEY` está presente y no es `"dry-run"`, el helper
importa dinámicamente el paquete `resend` y hace el envío real:

- 1 reintento con backoff 800 ms para errores 5xx transitorios.
- 4xx no reintentado.
- Si el paquete `resend` no está instalado (`npm install` no ejecutado),
  **cae a dry-run con warning** — no rompe la app. Esto da margen para
  desplegar el código sin la dependencia instalada en una sesión y
  hacer `npm install resend` después.

### Verificación DNS en producción

Resend exige verificar el dominio antes de enviar emails reales. Pasos
para Laura (`tunutrilaura.com`):

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
6. Configurar en VPS:
   ```bash
   nano /opt/crm-salamandra/.env.production
   # añadir RESEND_API_KEY=re_xxxxx
   # añadir RESEND_FROM_EMAIL=hola@tunutrilaura.com
   docker compose restart app
   ```
7. Smoke test: hacer una reserva desde la web — el email debe llegar
   al inbox del paciente. Si va a spam, verificar SPF/DKIM con
   [mail-tester.com](https://www.mail-tester.com/).

## Templates disponibles

### Citas

Ubicación: `lib/email/templates/citas/`.

| Template | Subject | Cuándo se dispara |
|---|---|---|
| `bookingReceived` | "Hemos recibido tu solicitud de cita" | `POST /api/public/c/[slug]/book` con `autoConfirmPublicBookings=false` (lista de espera). El paciente recibe ack inmediato. |
| `bookingConfirmed` | "Tu cita está confirmada" | (a) `POST /book` con `autoConfirmPublicBookings=true` (auto-confirm directo). (b) `PATCH /api/citas/bookings/[id]/confirm` (Laura confirma desde lista de espera). |
| `bookingRejected` | "Sobre tu solicitud de cita" | `PATCH /api/citas/bookings/[id]/reject`. Email educado con motivo opcional. |

### Diagrama lógico

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
   import { sendEmail } from "lib/email/resendClient.js";
   import { miTemplate } from "lib/email/templates/.../miTemplate.js";

   try {
     const tpl = miTemplate({ tenantName: tenant.name, brand: tenant.settings?.brand, ...datos });
     await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
   } catch (err) {
     process.stderr.write(`[modulo:accion] email fail: ${err.message}\n`);
   }
   ```
5. **Envuelve siempre en `try/catch`** — un fallo de email NUNCA debe
   romper el flujo de negocio.

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
