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
| `status` | ENUM | `pending, authorizing, authorized, paid, failed, refunded, expired, void` |
| `stripeCheckoutSessionId` | STRING **UNIQUE** | solo flujo de cobro inmediato |
| `stripePaymentIntentId` | STRING **UNIQUE** | idempotencia; ancla del flujo de retención |
| `authorizationExpiresAt` | DATE | copia de `capture_before`. **Nunca calculado** |
| `stripeCustomerId` | STRING | hueco reservado, hoy sin usar (ver §5) |
| `stripeRefundId`, `refundAmount`, `refundedAt` | | |
| `amountSnapshot` | INTEGER | precio en el momento de reservar (si cambia el tarifario, no afecta) |
| `metadata` | JSONB | |

Y en `Booking`: `paymentStatus`, `amount`, `holdExpiresAt`,
`authorizationExpiresAt`, `paymentSessionId`.

`Booking.paymentStatus` = `none | pending | authorizing | authorized | capturing |
paid | refunded | failed | void`:

| Valor | Significa | ¿Bloquea la hora? |
| --- | --- | --- |
| `none` | cita gratuita o creada a mano | sí |
| `authorizing` | está metiendo la tarjeta ahora | sí, mientras dure el hold |
| `authorized` | **dinero retenido, esperando a la profesional** | **sí, sin caducidad** |
| `capturing` | captura en vuelo (impide cobrar dos veces) | sí |
| `paid` | cobrado | sí |
| `void` | retención liberada, sin cobro | sí (la cita sigue en pie) |
| `pending` | flujo viejo de cobro inmediato | solo mientras dure el hold |

> **Por qué `authorized` no reutiliza `pending`.** `pending` significa "carrito
> potencialmente abandonado", y hay código que con el hold vencido esconde esas citas
> y las cancela. Una solicitud legítima con dinero retenido no puede compartir estado
> con algo que el sistema borra solo.

Migración: `npm run db:migrate:booking-auth` (aditiva e idempotente; descubre los
schemas por existencia de la tabla `bookings`, no por módulo activo).

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
| **Retener / cobrar / soltar** | `lib/payments/autorizacion.js` → `autorizarPago` · `capturarPago` · `liberarAutorizacion` — **funciones de librería, NO endpoints públicos** |
| Leer la caducidad | `lib/payments/autorizacion.js` → `leerCaducidadAutorizacion(charge)` |
| Cobro inmediato (sin llamantes hoy) | `lib/payments/checkout.js` → `createCheckoutSession(ctx, {...})` |
| Avisos de Stripe | `POST /api/webhooks/stripe/[tenantSlug]` |
| Reembolsar | `lib/payments/refund.js` → `refundPayment(ctx, session, { amount, reason })` |
| Enganche por módulo | `lib/payments/entityHooks.js` → `onEntityAuthorized` / `onEntityPaid` / `onEntityAuthorizationVoided` / `onEntityRefunded` |

Eventos de webhook que se procesan:

| Evento | Qué hace |
| --- | --- |
| `payment_intent.amount_capturable_updated` | la tarjeta quedó retenida → a la lista de espera |
| `payment_intent.succeeded` | se capturó → `paid` |
| `payment_intent.canceled` | retención liberada → `void`, **la cita no se cancela** |
| `payment_intent.payment_failed` | rechazo; **no** se cierra la sesión (puede reintentar con otra tarjeta) |
| `checkout.session.*`, `charge.refunded` | flujo de cobro inmediato y devoluciones |

> ⚠️ **Un PaymentIntent NUNCA emite un evento de caducidad** (eso solo lo hacen las
> Checkout Sessions). Cuando una retención muere, Stripe no avisa: hay que vigilarlo
> contra `authorizationExpiresAt`.

> **Por qué no hay endpoint público de cobro:** si expusiéramos una ruta que recibe
> `amount` en el body, cualquiera podría pagar 1 céntimo por una consulta. El importe
> lo calcula **siempre el servidor** a partir de `EventType.price`.

> **Métodos de pago: SOLO TARJETA**, y no es una simplificación. Bizum, SEPA e iDEAL
> no admiten captura manual (Stripe lo documenta como *"Manual capture support: No"*).
> Si se dejara elegir, el paciente escogería Bizum y o fallaría o cobraría al instante,
> rompiendo la promesa del flujo.

**El tenant va en la URL del webhook, deliberadamente.** Stripe no manda cabecera
`x-tenant`, y aunque la mandara no habría que fiarse: es exactamente el fallo que se
corrigió el 2026-07-26 en los webhooks de TutorLMS (el tenant venía en una cabecera que
controlaba quien llamaba → suplantación cross-tenant). Aquí el slug está en la ruta y la
firma se verifica con el `stripeWebhookSecret` **de ese** tenant.

---

## 3. Flujo de reserva con pago — RETENCIÓN, no cobro

> **Cambio de fondo (2026-07-29).** Antes se cobraba al reservar y pagar era lo que
> confirmaba la cita. Ahora **el paciente deja la tarjeta al reservar, no se le cobra,
> y el dinero se captura cuando la profesional confirma**. Decisión de Jorge: la
> profesional tiene que poder decir que no antes de que nadie pague.

```
1. El paciente elige hueco y rellena el formulario
2. POST /book → Booking { status: pending, paymentStatus: 'authorizing',
                          holdExpiresAt: now + 20 min }   ← guarda la HORA
              → devuelve clientSecret + publishableKey (NO una URL de Stripe)
3. El widget pinta el formulario de tarjeta DENTRO del iframe (Payment Element)
4. El paciente confirma la tarjeta → Stripe RETIENE el importe (no lo cobra)
5. webhook payment_intent.amount_capturable_updated
              → paymentStatus: 'authorized', holdExpiresAt: null,
                authorizationExpiresAt: <capture_before de Stripe>
              → AHORA entra en la lista de espera + email al paciente
6a. La profesional CONFIRMA → se captura → paymentStatus: 'paid'  ✅
6b. La profesional RECHAZA  → se suelta la retención → 'void', sin cobro
6c. Nadie decide en 7 días  → la retención caduca sola; la cita SIGUE EN PIE
                              marcada sin cobro, para que ella decida
```

### 3.1 Dos relojes, y no hay que confundirlos

Esta es la parte que más fácil se rompe.

| Reloj | Qué protege | Cuánto dura | Quién lo pone |
| --- | --- | --- | --- |
| `holdExpiresAt` | la **hora** mientras el paciente teclea la tarjeta | 20 min | nosotros |
| `authorizationExpiresAt` | el **dinero** retenido | ~7 días | **Stripe** |

`authorizationExpiresAt` es copia literal del `capture_before` de Stripe y **nunca se
calcula por nuestra cuenta**: el plazo real depende de la red de la tarjeta. Vive en
`charge.payment_method_details.card.capture_before` — **no** en `charge.capture_before`,
que no existe. Se lee en un único sitio: `leerCaducidadAutorizacion()`.
Comprobado empíricamente con `scripts/_probe-capture-before.mjs`.

Que caduque el segundo reloj **no libera la hora**: hay una persona esperando y quien
decide es la profesional.

### 3.2 Caducidad perezosa (importante)

La expiración del reloj CORTO se aplica **al calcular disponibilidad**, no con un cron
(`ocupaHuecoWhere` / `noEsCarritoAbandonado` en `lib/citas/booking.js`, con seis
consumidores). Un cron de limpieza sería solo cosmético: si se cae, los huecos se
liberan igual.

El matiz nuevo: solo son "carrito abandonado" los estados en los que **falta que actúe
el paciente** (`pending`, `authorizing`). Con la tarjeta ya retenida (`authorized`)
quien tiene que actuar es la profesional, y esa espera puede durar días sin que la
hora se libere. Fijado en `scripts/_smoke-ocupa-hueco.mjs`, que además lleva un control
que demuestra que la prueba distingue el comportamiento nuevo del viejo.

### 3.3 Matriz de casos (para no romper a los demás tenants)

| Tenant | `EventType.price` | Comportamiento |
| --- | --- | --- |
| nutri_laura | > 0 | Retiene al reservar; **cobra al confirmar** |
| aumenta / healim / demo | null | **Flujo actual intacto** (con o sin lista de espera) |
| cualquiera | > 0 pero sin Stripe **completo** | Error 503 claro, no reserva silenciosa |

"Stripe completo" ahora incluye la **clave publicable**: con el formulario embebido ya
no es opcional (`tenantPuedeAutorizar`). Con el checkout redirigido no se usaba.

**Solo tarjeta.** `payment_method_types: ["card"]` es deliberado: Bizum, SEPA e iDEAL
**no admiten captura manual**. Ofrecerlos rompería la promesa de "no se te cobra hasta
que se confirme". Un tenant que quiera Bizum necesita otro flujo.

Las citas creadas por la profesional **desde el dashboard** (paciente que llama por
teléfono) **no exigen pago**: nacen `paymentStatus: 'none'`.

Las citas creadas por Laura **desde el dashboard** (paciente que llama por teléfono)
**no exigen pago**: nacen `paymentStatus: 'none'`.

---

## 3.4 El consentimiento (y por qué se archiva)

El paciente marca una casilla —**no premarcada**— antes de dar la tarjeta:

> *Al reservar, tu banco retendrá 45,00 € en tu tarjeta. No es un cobro. Solo se te
> cobrará cuando se confirme la cita. Si no se confirma, la retención se libera sola.*

El texto y su versión viven en `lib/citas/consentimientoRetencion.js`, en un solo
sitio, porque los usa el navegador (para enseñarlo) y el servidor (para archivar qué
se aceptó). Si cada uno tuviera el suyo, archivaríamos la aceptación de un texto
distinto del que se leyó, que es no tener prueba de nada.

`/book` lo **exige** (sin él, 422) y guarda en `PaymentSession.metadata`: versión,
texto literal, importe, fecha e IP. La IP la pone el servidor; si viniera del body no
probaría nada. Al cambiar el texto hay que **subir la versión**.

Existe porque el banco del paciente le enseña un cargo pendiente que él no distingue
de un cobro. Sin esto, la primera reacción es una reclamación; con esto, la llamada
dura un minuto.

## 3.5 Qué ve la profesional

| Estado | Etiqueta | Qué puede hacer |
| --- | --- | --- |
| `authorized` | **Retenido, sin cobrar · 45,00 €** + *caduca en N días* | **Confirmar y cobrar 45,00 €** · Rechazar |
| `void` / `failed` | **Sin cobro · 45,00 €** | Confirmar (reintenta) · **Confirmar sin cobrar** · Rechazar |
| `paid` | Cobrada | — |

Dos decisiones deliberadas:

- **Ningún estado de retención usa el verde de "Cobrada".** "Retenido" leído como
  "cobrado" es la diferencia entre cerrar el día creyendo que has cobrado y saberlo.
- **El botón dice el importe.** "Confirmar" a secas, cuando además mueve 45 €, oculta
  justo el dato que hace falta en ese momento.

**Confirmar sin cobrar** es la salida cuando la retención ha caducado: hay una persona
real esperando y lo correcto no es rechazarla, es aceptarla y cobrarle en consulta.
Queda en auditoría.

> Pendiente: el tercer botón del diseño, **"Pedir otra tarjeta al paciente"**, no está
> construido. Necesita autorización nueva (el PaymentIntent muerto no se reutiliza),
> correo con token y página pública.

---

## 4. Cancelaciones: devolver o soltar

Todas las vías pasan por `reembolsarCitaSiProcede`, que decide **qué forma tiene el
dinero** antes de aplicar ninguna política:

- **Solo retenido** → se **suelta** (no hay comisión ni movimiento que devolver). No
  depende de quién cancele ni de la antelación: quedarse el dinero de alguien a quien
  no se le ha dado la cita no es una política, es un error.
- **Ya cobrado** → se **devuelve**, con la tabla de abajo.

> **El agujero que esto tapó (2026-07-29):** de las cinco vías de cancelación, el
> `DELETE` del panel era la ÚNICA que no liquidaba nada — cancelaba, auditaba y
> avisaba, pero el dinero se quedaba donde estuviera. Y `decidirReembolso` corta en su
> primera puerta si no consta `paid`, así que las retenidas ni se miraban: el paciente
> se quedaba con el importe bloqueado hasta que caducara solo. La decisión se toma
> DENTRO del helper, no en cada llamante, para que ninguna vía futura pueda olvidarse.

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

## 5.bis Cómo se prueba esto (2026-07-29)

**No hay framework de tests en el repo.** Las pruebas son scripts que ejercitan el
código de verdad contra Stripe en **modo prueba** y comprueban la base de datos.
**No hace falta la CLI de Stripe**: el SDK firma eventos de webhook con el mismo
secreto del tenant, que es lo que hace `stripe listen`.

| Script | Qué fija |
| --- | --- |
| `_smoke-autorizacion.mjs` | retener → cobrar → soltar, y los casos límite (doble captura, doble liberación, capturar lo caducado) |
| `_smoke-ocupa-hueco.mjs` | qué citas bloquean su hora, en 11 estados. **Lleva un control** que exige que el filtro nuevo dé un veredicto distinto al viejo: sin él, la prueba pasaría sin probar nada |
| `_smoke-book-autorizacion.mjs` | `POST /book` por HTTP y, sobre todo, que el **doble clic no cree dos retenciones** |
| `_smoke-webhook-retencion.mjs` | el webhook mete la solicitud en la lista de espera; idempotencia y firma falsa |
| `_smoke-confirmar-cobrar.mjs` | confirmar cobra y rechazar suelta, con sesión de admin. Fija **la regla de oro**: sin dinero, la cita NO se confirma |
| `_smoke-cancelar-retencion.mjs` | cancelar suelta el dinero por todas las vías, y una cita ya cobrada se sigue **devolviendo** |
| `_probe-capture-before.mjs` | sonda: dónde vive de verdad `capture_before` |

Utilidades de desarrollo (no son pruebas, sirven para mirar pantallas con datos de
verdad): `dev-precio-cita.js`, `dev-cita-retenida.js` (con `--soltar` para simular una
retención caducada), `dev-token-admin.js` y `dev-limpiar-pruebas.js`.

> `dev-limpiar-pruebas.js` solo borra los prefijos de los propios scripts
> (`smoke-…`, `ui-…`). Su primera versión filtraba por todo `@example.com` y se llevó
> por delante los datos de ejemplo del seed, que usan ese mismo dominio.

Todos limpian lo que crean y devuelven el precio del tipo de cita a como estaba.
Se paran solos si detectan claves `sk_live_`.

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
