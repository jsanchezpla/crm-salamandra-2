# Módulo Pagos — cobro online con Stripe

> Diseño aprobado 2026-07-27. Primer caso de uso: cobrar las citas de `nutri_laura`
> al reservar. La capa es **genérica**: sirve luego para pedidos, facturas u otros
> módulos sin rehacerla.

---

## 1. Por qué y qué se decidió

Laura (tenant `nutri_laura`) quiere que sus pacientes **paguen la cita al reservarla**.
Pidió Klarna en concreto.

**Situación de partida:** el CRM **no cobra online en absoluto**. El módulo de
facturación solo *registra* cobros a mano (`Payment` con `method: card|transfer|cash`).
No hay pasarela, ni checkout, ni webhooks de pago. `EventType` no tiene precio y
`Booking` no sabe nada de dinero.

**Decisión de pasarela: Stripe.** Klarna directo se descartó por coste y complejidad;
con Stripe, **activar Klarna es una casilla en su panel, sin tocar código**. Laura
enciende los métodos que quiera (tarjeta, Klarna, Bizum si está disponible) y a
nosotros nos da igual: la API de cobro y de reembolso es la misma para todos.

> Coste orientativo para una consulta de 75 €: tarjeta ≈ 1,38 € (1,5% + 0,25 €),
> Klarna ≈ 4,14 € (4,99% + 0,40 €). Klarna además clasifica servicios de salud como
> *restricted business*, así que su activación puede requerir aprobación. Es decisión
> de negocio de Laura; el sistema funciona con o sin ella.

### Reglas de negocio (cerradas con el cliente)

| Regla | Decisión |
| --- | --- |
| Cuándo se cobra | **Al reservar**. Pagar = cita confirmada |
| Lista de espera | **Se elimina** para nutri_laura (hoy `autoConfirmPublicBookings=false`) |
| Precio | **Por tipo de cita** (`EventType`) |
| Cancela el cliente ≥24 h antes | **Reembolso automático íntegro** |
| Cancela el cliente <24 h antes | **Sin devolución** |
| Cancela Laura | **Reembolso íntegro siempre** |
| No-show | **Sin devolución** |
| Factura | **No se genera** (billing queda al margen) |

> ⚠️ Consecuencia que Laura debe tener clara: al quitar la lista de espera **pierde el
> filtro de pacientes**. Entra quien pague. Rechazar a alguien pasa a ser "cancelar y
> devolver".

---

## 2. Arquitectura

Capa genérica en `lib/payments/`, **no atada a citas**. Cualquier módulo puede cobrar
por una entidad suya usando el par `entityType` + `entityId` (mismo patrón que ya usa
`Notification`).

```
Módulo (citas, orders…)  →  lib/payments  →  Stripe
                                 ↑
                          webhook por tenant
```

### 2.1 Claves por tenant (BYOK)

El dinero es de Laura, así que **la cuenta de Stripe es suya**. Las claves viven
cifradas en `tenant.settings.integrations`, con el patrón que ya existe para las
claves de IA y Resend (`lib/crypto/secretBox.js`, AES-256-GCM con
`SETTINGS_ENCRYPTION_KEY`):

- `stripeSecretKey` (cifrada)
- `stripePublishableKey`
- `stripeWebhookSecret` (cifrada)

Helper `lib/payments/stripeConfig.js` → `getTenantStripeConfig(ctx)`, calcado de
`lib/outreach/resendConfig.js`. Se gestionan desde `PATCH /api/tenant/settings`
(solo admin, devuelve pistas enmascaradas, nunca en claro).

**Validación obligatoria:** si se guarda `stripeSecretKey` sin `stripeWebhookSecret`,
se rechaza. Sin webhook secret los cobros se quedarían colgados sin confirmar.

### 2.2 Modelo de datos

Tabla nueva `payment_sessions` (no se reutiliza `Payment`, que está atada a
`invoiceId` y aquí no hay factura):

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID PK | |
| `entityType` / `entityId` | STRING / UUID | `booking`, `order`… |
| `amount` | **INTEGER** | **céntimos**. Nunca decimales para dinero |
| `currency` | STRING(3) | `eur` |
| `status` | ENUM | `pending, paid, failed, refunded, expired` |
| `stripeCheckoutSessionId` | STRING **UNIQUE** | |
| `stripePaymentIntentId` | STRING **UNIQUE** | idempotencia |
| `stripeRefundId`, `refundAmount`, `refundedAt` | | |
| `amountSnapshot` | INTEGER | precio en el momento de reservar (si cambia el tarifario, no afecta) |
| `metadata` | JSONB | |

Y en `Booking`: `paymentStatus` (`none|pending|paid|refunded|failed`), `amount`,
`holdExpiresAt`, `paymentSessionId` *(fase 3)*.

En `EventType`: **`price`** (INTEGER, céntimos, nullable) — **null o 0 = cita
gratuita**, y entonces la reserva no pasa por el checkout. Así los tenants que no
cobran (`aumenta`, `healim`, `demo`) siguen funcionando sin tocar nada.

> Sin `priceCurrency`: se descartó por YAGNI. La moneda vive en `PaymentSession`
> (por si algún día hace falta), pero un campo por tipo de cita que nadie va a
> cambiar solo añade sitios donde equivocarse. Hoy todo es EUR.

**Euros vs céntimos:** la conversión está centralizada en `lib/payments/money.js`
(`eurosToCents` / `centsToEuros` / `formatMoney`). Los euros existen SOLO en la
interfaz; la API y la base de datos siempre en céntimos. Un `* 100` suelto repartido
por la UI es exactamente como se cuela un cobro de 0,75 € en vez de 75 €.

> **Por qué `paymentStatus` aparte de `status`:** si metiéramos "esperando pago" dentro
> del enum `status`, se mezclaría con la lista de espera y Laura vería reservas a medias
> en su panel. Separados, cada campo significa una sola cosa: `status` = agenda,
> `paymentStatus` = dinero.

### 2.3 Endpoints

| Qué | Dónde |
| --- | --- |
| Crear el cobro | `lib/payments/checkout.js` → `createCheckoutSession(ctx, {...})` — **función de librería, NO endpoint público** |
| Confirmación de Stripe | `POST /api/webhooks/stripe/[tenantSlug]` |
| Reembolsar | `lib/payments/refund.js` → `refundPayment(ctx, session, { amount, reason })` |
| Enganche por módulo | `lib/payments/entityHooks.js` → `onEntityPaid` / `onEntityRefunded` |

> **Por qué el checkout NO es un endpoint público** (cambio respecto al primer boceto):
> si expusiéramos una ruta que recibe `amount` en el body, cualquiera podría pagar
> 1 céntimo por una consulta. El importe lo calcula **siempre el servidor** a partir
> de sus propios datos (`EventType.price`). El flujo es
> `POST /book` → (servidor lee el precio) → `createCheckoutSession()` → URL de Stripe.

> **Métodos de pago:** la sesión se crea **sin** `payment_method_types`, así que se
> ofrecen los que el tenant tenga activados en su panel de Stripe. Activar Klarna (o
> Bizum) es una casilla en su panel, **sin tocar código**.

**El tenant va en la URL del webhook, deliberadamente.** Stripe no manda cabecera
`x-tenant`, y aunque la mandara no habría que fiarse: es exactamente el fallo que se
corrigió el 2026-07-26 en los webhooks de TutorLMS (el tenant venía en una cabecera que
controlaba quien llamaba → suplantación cross-tenant). Aquí el slug está en la ruta y la
firma se verifica con el `stripeWebhookSecret` **de ese** tenant.

---

## 3. Flujo de reserva con pago

El problema a resolver es **la carrera por el hueco**: entre que el cliente pulsa
"pagar" y Stripe confirma pasan minutos. Si no se bloquea el hueco, dos personas pagan
la misma hora; si se bloquea para siempre, quien abandona el carrito deja el hueco
muerto.

```
1. Cliente elige hueco
2. POST /book  →  Booking { status: pending, paymentStatus: pending,
                            holdExpiresAt: now + 15 min }     ← BLOQUEA el hueco
3. POST /checkout  →  URL de Stripe
4a. Paga     → webhook → paymentStatus: paid, status: confirmed  ✅
4b. Abandona → a los 15 min el hueco vuelve a estar libre
```

### 3.1 Caducidad perezosa (importante)

La expiración se aplica **al calcular disponibilidad**, no con un cron:

```js
// una reserva provisional caducada NO bloquea
paymentStatus !== 'pending' || holdExpiresAt > now()
```

Hay que tocarlo en `lib/citas/booking.js` (`findBookingOverlap`) y en los endpoints
`availability` y `availability/month`. Un cron de limpieza es opcional y **solo
cosmético**: si se cae, los huecos se liberan igual. Sin esta decisión, un fallo del
cron dejaría la agenda de Laura bloqueada.

### 3.2 Matriz de casos (para no romper a los demás tenants)

| Tenant | `EventType.price` | Comportamiento |
| --- | --- | --- |
| nutri_laura | > 0 | Cobra al reservar; pagar = confirmada |
| aumenta / healim / demo | null | **Flujo actual intacto** (con o sin lista de espera) |
| cualquiera | > 0 pero sin Stripe configurado | Error 402 claro, no reserva silenciosa |

Las citas creadas por Laura **desde el dashboard** (paciente que llama por teléfono)
**no exigen pago**: nacen `paymentStatus: 'none'`.

---

## 4. Reembolsos

Se enganchan en `lib/citas/cancelBooking.js`, que ya es el helper compartido por las
dos vías de cancelación (enlace del email y portal "Mis citas").

| Quién cancela | Cuándo | Reembolso |
| --- | --- | --- |
| Cliente | ≥ 24 h antes | **Íntegro, automático** |
| Cliente | < 24 h antes | Ninguno |
| Laura | Cuando sea | **Íntegro, automático** |
| — (no-show) | — | Ninguno |

El cálculo es una simple diferencia entre instantes: `scheduledAt - now >= 24h`.
**No hay problema de zonas horarias ni de cambio de hora**: ambos son `timestamptz`
(instantes absolutos), y su diferencia no depende del huso.

La API de reembolso de Stripe es la misma para tarjeta y para Klarna, así que **el
código no distingue** el método de pago.

---

## 5. Riesgos y mitigaciones

De 25 riesgos revisados adversarialmente, los que **cambian el diseño**:

| Riesgo | Mitigación |
| --- | --- |
| **Dos clientes pagan el mismo hueco** | Comprobar en código no basta (hay carrera). Bloqueo en la transacción de reserva; a futuro, constraint `EXCLUDE` con rangos temporales en PostgreSQL. Ojo: un `UNIQUE(scheduledAt)` **no** cubre solapamientos parciales (10:00/60min vs 10:30/45min) |
| **Doble cobro** por webhook reintentado | Tabla de eventos con `stripe_event_id` **UNIQUE** → el reintento se ignora. Stripe reintenta durante 3 días |
| **Stripe cobra pero la BD falla** | Reembolso automático de compensación |
| **Bloqueo de agenda** con reservas fantasma | Hold corto (15 min) + límite de holds simultáneos por email/IP (el endpoint es público, 30 req/min por IP) |
| **Precio cambiado entre reservar y pagar** | `amountSnapshot` en la sesión; el webhook valida que el importe cobrado coincide |
| **Tenant `demo` cobrando de verdad** | `assertNotDemoPaidCall` (ya existe en `lib/demo/isDemo.js`) + demo nunca tiene claves Stripe |
| **Secretos en logs** | Nunca loguear el objeto de Stripe ni las claves; redactar antes de escribir |

---

## 6. Fases

| Fase | Contenido |
| --- | --- |
| **1** | Capa de pagos: modelo `payment_sessions`, `stripeConfig`, checkout, webhook, refund, migración |
| **2** | `price` en `EventType` + UI para que Laura ponga precios |
| **3** | Reserva con pago: hold, caducidad perezosa, quitar lista de espera |
| **4** | Reembolsos automáticos (24 h / Laura / no-show) |
| **5** | UI: precio en el widget, importe y estado en "Mis citas" (**con aviso de <24 h antes de cancelar**), estado de pago en el panel |
| **6** | E2E en modo test → claves reales → producción |

**Fuera del alcance inicial** (a propósito): captcha, reembolsos parciales, botón de
resincronizar pagos con webhook perdido.

Las fases 1-5 se desarrollan y prueban enteras con el **modo test** de Stripe. La cuenta
real de Laura solo hace falta en la fase 6.

---

## 7. Qué tiene que hacer Laura

1. **Abrir cuenta en Stripe** a su nombre/NIF (verificación de identidad + cuenta
   bancaria; puede tardar de horas a un par de días).
2. **Decidir el precio** de cada tipo de cita.
3. **Validar la política de cancelación**, que debe mostrarse en el checkout:
   > *Puedes cancelar hasta 24 horas antes de la cita y se te devolverá el importe
   > íntegro automáticamente. Las cancelaciones con menos de 24 horas de antelación, o
   > la no asistencia, no dan derecho a devolución.*
4. Opcional: solicitar **Klarna** y mirar si tiene **Bizum** en su panel.

> Fiscal: se decidió que la cita **no genera factura**. Conviene que su gestoría
> confirme si necesita emitir al menos factura simplificada por estos cobros; el módulo
> de facturación ya existe y podría engancharse más adelante.
