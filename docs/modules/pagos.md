# Módulo Pagos — cobro online con Stripe

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este
> mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién
> tiene el módulo NO se lista aquí** (una lista a mano se queda vieja):
> `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | sin moduleKey propio: **cuelga de `citas`** (todo lo que cobra pasa por `hasModule("citas")` en `/book`, `/pagar/[token]` y los endpoints de `bookings`); sus tablas son CORE (`migrate-payments-sprint-1` en `scripts/_module-migrations.js`) y cobrar depende de que el tenant tenga sus claves de Stripe, no de un módulo. **No es `billing`**: no reutiliza `Payment` ni genera factura. |
| **Reina** | `nutri_laura`: el doc nace para cobrar sus citas, y de su consulta salen la retención al reservar, el pago a plazos (`lib/payments/fraccionado.js`) y la regla de no devolver dinero. |
| **Pantallas** | Ninguna propia. Panel: `app/(dashboard)/citas/page.jsx` → `modules/default/CitasModule.jsx` (`/citas`: chip de cobro, «Confirmar y cobrar», rechazar, pedir otra tarjeta), `app/(dashboard)/citas/tipos/page.jsx` (`/citas/tipos`: precio, plazos y bono por tipo de cita), `app/(dashboard)/configuracion/page.jsx` → `modules/config/ConfigModule.jsx` (`/configuracion`: claves de Stripe), ficha `app/(dashboard)/clientes/[id]/page.jsx` → `components/clients/ClientBonosSection.jsx`. Públicas: `app/widget/c/[tenantSlug]/book/page.jsx` (Payment Element al reservar) y `app/widget/c/[tenantSlug]/pagar/[token]/page.jsx` (volver a meter la tarjeta). |
| **Endpoints** | Webhook: `app/api/webhooks/stripe/[tenantSlug]/route.js` (1; el tenant va en la URL y la firma se verifica con SU secreto). Públicos: `app/api/public/c/[tenantSlug]/book/route.js` (crea la retención o el checkout), `app/api/public/c/[tenantSlug]/pagar/[token]/route.js` (clientSecret para la tarjeta nueva), `app/api/public/c/[tenantSlug]/booking/[token]/route.js` (cancelar → soltar). Internos de `citas`: `app/api/citas/bookings/[id]/{confirm,reject,pedir-tarjeta}/route.js`, `app/api/citas/bookings/[id]/route.js` (PATCH/DELETE), `app/api/citas/event-types/route.js` (precio), `app/api/citas/packs/**` (2, bonos). Claves: `app/api/tenant/settings/route.js`. **No hay endpoint que reciba `amount`**: el importe lo calcula siempre el servidor. |
| **Lógica** | `lib/payments/` (8): `stripeConfig.js` (claves BYOK cifradas), `eventosWebhook.js` (los 11 eventos de Stripe que el webhook trata, cada uno con su porqué; los leen la tarjeta de Configuración y `comprobar-stripe.js`, para que no vuelvan a divergir), `autorizacion.js` (retener/capturar/soltar; `leerCaducidadAutorizacion`), `checkout.js` (cobro inmediato: bonos y plazos), `fraccionado.js` (tope de cuotas con subscription schedule), `refund.js` (devolución idempotente), `entityHooks.js` (qué significa pagado/soltado/devuelto para cada `entityType`; hoy solo `booking`), `money.js` (céntimos ↔ euros). En `lib/citas/`: `cobroCita.js` (cobrar al confirmar, soltar al rechazar), `reembolsoCita.js` (ninguna cancelación se olvida del dinero), `politicaReembolso.js` (**no se devuelve al cancelar**, 07/08/2026; una excepción con nombre, `MOTIVO_COBRO_DE_CITA_CANCELADA`, 20/08/2026), `caducidadRetencion.js` (vigilar lo que caduca), `tokenPago.js` (enlace «vuelve a meter tu tarjeta»), `consentimientoRetencion.js` (texto que se archiva), `packs.js` (bonos), `dinero.js` (quién ve el dinero), `booking.js` (`ocupaHuecoWhere`/`noEsCarritoAbandonado`). |
| **UI** | Sin `modules/payments/` ni `components/payments/`: la UI es la de Citas (arriba) más `components/clients/ClientBonosSection.jsx`, y desde el 26/08/2026 la sección «Mis pagos» del portal (`mi-perfil`): el próximo pago de cada fraccionado, calculado por `proximoPagoDe` (`lib/citas/packs.js`) como el aniversario mensual de la compra — el calendario prometido, no el estado real del cobro. |
| **Modelos** | `models/tenant/`: `PaymentSession` (`payment_sessions`), `StripeWebhookEvent` (`stripe_webhook_events`, idempotencia), `SessionPack` (`session_packs`, bonos); columnas en `Booking` (`bookings`: `paymentStatus`, `amount`, `holdExpiresAt`, `authorizationExpiresAt`, `paymentSessionId`, `packId`) y en `EventType` (`event_types`: `price`, `sessionsCount`, `instalmentPrice`, `instalmentMonths`). |
| **Interruptores y parámetros** | ninguno que lea el código. Lo que enciende el cobro es tener `stripeSecretKey` + `stripePublishableKey` + `stripeWebhookSecret` en `tenant.settings.integrations` (`tenantPuedeAutorizar`) y `EventType.price > 0`; el `citas.autoConfirmPublicBookings` que lee `/book` es de Citas. |
| **Pantallas propias** | ninguna. |
| **Scripts** | Migraciones vivas: `migrate-payments-sprint-1.js` (CORE: `payment_sessions`, `stripe_webhook_events`, `event_types.price`, `bookings.payment_status`), `migrate-booking-authorization.js` (`npm run db:migrate:booking-auth`) y `migrate-packs-sesiones.js` (las dos en `MODULES.citas`). Herramientas: `configure-stripe-tenant.js` (guarda las claves desde variables de entorno), `comprobar-stripe.js` e `inspeccionar-cita-cobro.js` (solo lectura), `vigilar-retenciones.js` (temporizador horario en el VPS: avisa de retenciones que caducan), `dev-precio-cita.js`, `dev-cita-retenida.js`, `dev-token-admin.js`, `dev-limpiar-pruebas.js`. ONE_OFF ya ejecutados: `_hechos/reponer-precios-nutri-laura.js`, `arreglar-suscripciones-sin-tope.js`. |
| **Pruebas** | En `npm test` (sin nada encendido): `scripts/_smoke-payments-fraccionado-autorizacion.mjs` (`node:test`, 19/08/2026; falsea la LIBRERÍA `stripe` con un gancho de `node:module`, como `_smoke-retencion-viva-o-muerta`, y ninguna llamada sale a la red): lo que devuelve y lo que le pide a Stripe `lib/payments/fraccionado.js` —`topePuesto`: existir no es estar puesto, solo `end_behavior: cancel` con la fase que cubre las cuotas (el caso del 07/08/2026); `ponerTopeDeCuotas` reutiliza el calendario que haya, mide la fase en `duration` y no en `iterations`, cuenta la primera cuota ya cobrada, y es idempotente; `sesionDeFactura` lee la metadata de la cuota donde la deja la API de hoy (`parent.subscription_details`, el fallo del 10/08) y en los tres sitios viejos; `frenarSiYaEstaPagado`, el segundo cerrojo: cuenta las pagadas y cancela al llegar al total (>=, no ==), y desde el 21/08/2026 que le pide a Stripe **solo las `paid` de esa suscripción y la página entera (`limit: 100`)** —la prueba se pone roja si alguien lo baja— y que con un plan de más de 24 cuotas y sin calendario el recuento llega al total y SÍ frena— y `lib/payments/autorizacion.js` —`capture_before` vive en `payment_method_details.card`, no en la raíz; hacen falta las TRES claves; `autorizarPago` crea la fila PRIMERO y el PaymentIntent con captura manual después, y en las cuatro demos da 403; `leerEstadoAutorizacion` distingue viva / muerta / inexistente (claves rotadas no es una duda) / «no se sabe» sin lanzar nunca; `capturarPago` y `liberarAutorizacion` con la verdad de Stripe y no la de nuestra fila, con idempotencia por fila—. Y `scripts/_smoke-citas-reembolso-excepcion.mjs` (`node:test`, 20/08/2026): las dos caras de `decidirReembolso` —una cancelación normal no devuelve nada, cancele quien cancele y con el motivo que sea; solo `MOTIVO_COBRO_DE_CITA_CANCELADA` devuelve, y ni siquiera él si el dinero está solo retenido o ya devuelto—. Y `scripts/_smoke-stripe-eventos.mjs` (`node:test`, 20/08/2026): la lista de `lib/payments/eventosWebhook.js` contra los `case` del webhook, para que la pantalla no vuelva a pedirle al cliente menos eventos de los que el CRM necesita; falla por los dos lados (falta uno, o sobra uno que el webhook ignora) y lo primero que comprueba es que sigue leyendo casos, para no quedarse comparando contra nada. Las anteriores, sin `node:test`: `scripts/_smoke-fraccionado.mjs`, `_smoke-no-se-devuelve.mjs`, `_smoke-packs-sesiones.mjs`, `_smoke-pedir-otra-tarjeta.mjs`. Con base de datos: `_smoke-autorizacion.mjs`, `_smoke-ocupa-hueco.mjs`, `_smoke-packs-reserva.mjs`, `_smoke-fraccionado-reloj.mjs`, `_smoke-retencion-viva-o-muerta.mjs` (con `--import ./scripts/_fake-stripe-loader.mjs`). Con servidor y base de datos: `_smoke-book-autorizacion.mjs`, `_smoke-webhook-retencion.mjs`, `_smoke-confirmar-cobrar.mjs`, `_smoke-cancelar-retencion.mjs`, `_smoke-carreras-cobro.mjs`, `_smoke-pedir-tarjeta.mjs`, `_smoke-vigilar-retenciones.mjs`, `_smoke-dinero-solo-direccion.mjs`. Sonda: `_probe-capture-before.mjs`. Solo la de `node:test` lleva `// @prueba ligera`; a las demás las clasifica `scripts/pruebas.mjs` leyendo el fichero. |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` (la demo pública nunca cobra de verdad —`assertNotDemoPaidCall` en `lib/demo/isDemo.js`— y se audita lo que mueve dinero). |
| **En este doc** | 2. Arquitectura · 3. Flujo de reserva con pago — RETENCIÓN, no cobro · 3.5 Qué ve la profesional · 4. Cancelaciones: soltar, y devolver solo en un caso · 5. Riesgos y mitigaciones · 5.bis Cómo se prueba esto (2026-07-29) · 6. Fases |

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
| Cuándo se cobra | **Al confirmar la profesional**: al reservar se RETIENE en la tarjeta (§3); un bono o un plazo se cobra al reservar por Checkout |
| Lista de espera | **Se mantiene**: con precio la cita nace `pending` y espera el visto bueno (§3); `autoConfirmPublicBookings=false` en nutri_laura |
| Precio | **Por tipo de cita** (`EventType`), y también precio de bono y de plazo (`sessionsCount`, `instalmentPrice`, `instalmentMonths`) |
| Cancela quien sea, antes o después | **No se devuelve nunca desde el CRM** (07/08/2026, §4). Solo se SUELTA lo retenido; lo cobrado se queda y la consulta decide |
| No-show | **Sin devolución** |
| Factura | **No se genera** (billing queda al margen) |

> **Histórico (hasta 07/08/2026):** el diseño del 27/07 cerraba «se cobra al reservar,
> se quita la lista de espera, reembolso automático íntegro si cancela el cliente con
> ≥24 h o si cancela Laura». Lo primero cambió el 29/07 (retención, no cobro); lo
> segundo no llegó a quitarse; lo tercero se construyó y se retiró el 07/08 a petición
> de Rodrigo (`lib/citas/politicaReembolso.js`).

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
`invoiceId` y aquí no hay factura), más `stripe_webhook_events`
(`StripeWebhookEvent`: un `stripe_event_id` UNIQUE por evento recibido, es la
idempotencia del webhook) y, desde el 04/08/2026, `session_packs` (`SessionPack`:
los bonos, ver `lib/citas/packs.js` y «Tipos de cita ocultos» en `citas.md`):

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
`authorizationExpiresAt`, `paymentSessionId`, `packId` y `sessionNumber` (la sesión
N de un bono).

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
cobran (`aumenta`, las demos, `somos`) siguen funcionando sin tocar nada. Desde el
04-05/08/2026 lleva además `sessionsCount` (un tipo que vale por N sesiones: bono),
`instalmentPrice` e `instalmentMonths` (el mismo bono pagado a plazos; ver «Pago a
plazos» en `citas.md` y `lib/payments/fraccionado.js`). El importe de una compra lo
calcula `precioDeCompra` en `lib/citas/packs.js`.

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
| Cobro inmediato (Checkout) | `lib/payments/checkout.js` → `createCheckoutSession(ctx, {...})`. Lo llama `/book` (`app/api/public/c/[tenantSlug]/book/route.js`) cuando lo que se compra es un **bono** o un **plazo**: eso no se retiene, se cobra, y en el fraccionado la sesión nace con `recurring` (suscripción) |
| Tope de cuotas | `lib/payments/fraccionado.js` (`subscription_schedule` + `frenarSiYaEstaPagado`). El segundo cerrojo cuenta las facturas pagadas pidiéndole a Stripe la **página entera** (`limit: 100`), no 24 como hasta el 21/08/2026: el tope del producto son 36 cuotas (`EventType.instalmentMonths`, min 2 max 36), así que con 24 el cerrojo no llegaba nunca al total en los planes de 25 meses o más —contestaba «cuota 24 de N» en cada webhook y no cancelaba—, justo en los planes largos, que son los que más dinero se llevan si el calendario no se llegó a poner. **Este límite y el `max: 36` del modelo van atados a mano**: si algún día ese máximo sube por encima de 100, habrá que paginar y nada lo cantará |
| Pedir otra tarjeta | `POST /api/citas/bookings/[id]/pedir-tarjeta` → retención NUEVA + correo con token (`lib/citas/tokenPago.js`); la página pública `/widget/c/<slug>/pagar/[token]` pide su `clientSecret` a `GET /api/public/c/[slug]/pagar/[token]` |
| Avisos de Stripe | `POST /api/webhooks/stripe/[tenantSlug]` |
| Reembolsar | `lib/payments/refund.js` → `refundPayment(ctx, session, { amount, reason })`. **Sin llamantes desde el 07/08/2026** (§4): se conserva por si algún día hace falta devolver desde el CRM, pero hoy nadie lo llama. Las devoluciones se hacen a mano desde el panel de Stripe y las apunta el webhook (`charge.refunded`) |
| Enganche por módulo | `lib/payments/entityHooks.js` → `onEntityAuthorized` / `onEntityPaid` / `onEntityAuthorizationVoided` / `onEntityRefunded` / `onEntityExpired` |
| Quién ve el dinero | `lib/citas/dinero.js` (`citaSegunRol`…): el importe y el estado de cobro solo viajan en el JSON a dirección; el equipo con rol `user` no los recibe (`_smoke-dinero-solo-direccion.mjs`) |

Eventos de webhook que se procesan:

| Evento | Qué hace |
| --- | --- |
| `payment_intent.amount_capturable_updated` | la tarjeta quedó retenida → a la lista de espera |
| `payment_intent.succeeded` | se capturó → `paid` |
| `payment_intent.canceled` | retención liberada → `void`, **la cita no se cancela** |
| `payment_intent.payment_failed` | rechazo; **no** se cierra la sesión (puede reintentar con otra tarjeta) |
| `checkout.session.completed` / `async_payment_succeeded` | cobro de bono o plazo → `paid`, **nace el bono entero** y, si es fraccionado, se le pone el tope de cuotas |
| `checkout.session.async_payment_failed` / `expired` | el Checkout murió sin pagar → `failed` / `expired` |
| `charge.refunded` | devolución hecha **desde el panel de Stripe**: se apunta (parcial → la cita sigue pagada; total → `refunded`). Si aún no existe la `PaymentSession`, lanza para que Stripe reintente (hasta 6 h) |
| `invoice.paid` / `invoice.payment_failed` | cuotas 2ª en adelante del fraccionado: se apuntan y, si el tope no llegó a ponerse, `frenarSiYaEstaPagado` cancela al completar el total (cuenta las pagadas con `limit: 100`, la página entera; ver «Tope de cuotas») |

⚠️ **Hay que dar de alta esos eventos en el endpoint de Stripe del cliente.** La lista
se declara UNA vez en **`lib/payments/eventosWebhook.js`** (cada evento con su porqué,
escrito para quien está delante del panel de Stripe) y la leen los dos sitios que la
necesitan: la tarjeta de Stripe en Configuración (`modules/config/ConfigModule.jsx`), que
se los enseña al cliente para que los marque, y `scripts/comprobar-stripe.js`, que va a
Stripe y comprueba que están.

Estuvo copiada hasta el 20/08/2026 y divergió: la pantalla pedía cinco eventos
(`checkout.session.*` + `charge.refunded`) de los once que el webhook trata, así que quien
la siguiera se quedaba sin los de `payment_intent.*` —la retención se hace, nadie avisa y
la cita nunca entra en la lista de espera— y sin los de `invoice.*`. No mordió porque el
webhook de nutri_laura se dio de alta a mano con la lista buena. Que no vuelva a divergir
lo vigila `scripts/_smoke-stripe-eventos.mjs`, que compara la lista contra los `case` del
webhook y falla por los dos lados (falta uno, o sobra uno que el webhook ignora).

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
| nutri_laura | > 0 | Retiene al reservar; **cobra al confirmar**. Si el tipo es un bono o se paga a plazos, Checkout y cobro al reservar |
| aumenta / demo / cualquiera sin precio | null | **Flujo actual intacto** (con o sin lista de espera) |
| cualquiera | > 0 pero sin Stripe **completo** | Error 503 claro, no reserva silenciosa |

"Stripe completo" ahora incluye la **clave publicable**: con el formulario embebido ya
no es opcional (`tenantPuedeAutorizar`). Con el checkout redirigido no se usaba.

**Solo tarjeta.** `payment_method_types: ["card"]` es deliberado: Bizum, SEPA e iDEAL
**no admiten captura manual**. Ofrecerlos rompería la promesa de "no se te cobra hasta
que se confirme". Un tenant que quiera Bizum necesita otro flujo.

Las citas creadas por la profesional **desde el dashboard** (paciente que llama por
teléfono) **no exigen pago**: nacen `paymentStatus: 'none'`. Y la sesión de un **bono**
tampoco pasa por caja (ya está pagada): nace sin precio, enganchada al bono
(`packId`, `sessionNumber`) y, desde el 07/08/2026, **también espera en la lista**
salvo que la ficha de esa paciente tenga «citas autoconfirmadas».

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
| `void` / `failed` | **Sin cobro · 45,00 €** | Confirmar (reintenta) · **Confirmar sin cobrar** · **Pedirle otra tarjeta** · Rechazar |
| `paid` | Cobrada | — |

> Esto lo ve **dirección**. Al equipo con rol `user` ni el chip ni el importe le
> llegan en el JSON (`lib/citas/dinero.js`, 07/08/2026, queja de Laura).

Dos decisiones deliberadas:

- **Ningún estado de retención usa el verde de "Cobrada".** "Retenido" leído como
  "cobrado" es la diferencia entre cerrar el día creyendo que has cobrado y saberlo.
- **El botón dice el importe.** "Confirmar" a secas, cuando además mueve 45 €, oculta
  justo el dato que hace falta en ese momento.

**Confirmar sin cobrar** es la salida cuando la retención ha caducado: hay una persona
real esperando y lo correcto no es rechazarla, es aceptarla y cobrarle en consulta.
Queda en auditoría.

**Pedirle otra tarjeta** está construido (13/08/2026): `POST
/api/citas/bookings/[id]/pedir-tarjeta` crea una retención NUEVA (el PaymentIntent
muerto no se reutiliza), vuelve a poner la cita en `authorizing` con `holdExpiresAt`
igual a la vida del enlace (para que no desaparezca de la lista de espera) y manda el
correo `pedirTarjeta` con un token (`lib/citas/tokenPago.js`, 7 días) que abre
`/widget/c/<slug>/pagar/[token]`. Antes de crearla le pregunta a Stripe si la retención
vieja sigue viva (`estorbaParaPedirOtraTarjeta`, `lib/citas/cobroCita.js`): si lo está
—o no se puede saber— responde 409, para no dejar al paciente con dos importes
bloqueados. El detalle y los cinco desenlaces, en `citas.md` → «Cuando el dinero se
pierde: las tres salidas». Pruebas: `_smoke-pedir-tarjeta.mjs` (HTTP),
`_smoke-pedir-otra-tarjeta.mjs` y `_smoke-retencion-viva-o-muerta.mjs` (guarda).

---

## 4. Cancelaciones: soltar, y devolver solo en un caso

⚠️ **REGLA DESDE EL 07/08/2026 (Rodrigo): el CRM no devuelve dinero al cancelar.**
«No se devuelve el dinero nunca. Ya lo harán ellos manualmente si tal. Si se cancela
algo, se mantiene la cita: la cita no se puede cancelar una vez pagada, se puede
cancelar una sesión concreta.» Lo que se cancela es UNA SESIÓN, no la compra: lo
pagado sigue pagado y se le da otra fecha; si algún día hay que devolver algo, lo
decide la consulta y lo hace **a mano desde el panel de Stripe**, donde se ve el cobro
entero y quien lo hace responde por él. Una devolución automática es dinero saliendo
de la cuenta de un cliente sin que nadie lo haya mirado.

Vive en `lib/citas/politicaReembolso.js`: `decidirReembolso` devuelve `reembolsar:
false` para toda cancelación, y se conservan la función y su forma de respuesta para
que, si el negocio cambia de idea, el cambio vuelva a ser AHÍ y en un solo sitio. Lo
fija `scripts/_smoke-no-se-devuelve.mjs` (en `npm test`): nadie recupera el dinero
automáticamente, y ningún mensaje del portal promete devolución.

**La única excepción (20/08/2026, Jorge): `MOTIVO_COBRO_DE_CITA_CANCELADA`.** Se
capturó el cobro de una cita que otra petición ya había cancelado —la carrera de
milisegundos de `/confirm`, §5—: ahí sí se devuelve, entero. La regla de arriba se
pensó para cuando cancela la paciente, con una compra viva de la que se mueve una
sesión; aquí el cobro es un fallo NUESTRO y no compra nada, porque la cita ya no
existe. La excepción entra **por su nombre**: quien no pasa `motivo` a
`reembolsarCitaSiProcede` sigue sin devolver nada, así que las cinco vías de
cancelación no cambian. Lo fija `scripts/_smoke-citas-reembolso-excepcion.mjs`, que
prueba las dos caras.

Todas las vías de cancelación (enlace del email, portal, rechazo desde el panel, PATCH
y DELETE de admin) pasan por `reembolsarCitaSiProcede` (`lib/citas/reembolsoCita.js`),
que decide **qué forma tiene el dinero**:

- **Sesión de un bono** → no se toca el dinero: la sesión **vuelve al bono** (las
  sesiones se cuentan desde las citas, `estadoPack`) y se le da otra fecha. Devolver un
  bono es una decisión de la consulta, no algo que se dispare por mover una hora.
- **Solo retenido** (`authorized`, `capturing`, `failed`) → se **suelta**
  (`soltarRetencionDeCita`). No depende de quién cancele ni de la antelación: retener
  no es cobrar, y dejarle a alguien el dinero congelado por una cita que no va a
  existir no es «no devolver», es retenerlo sin motivo.
- **Ya cobrado** (`paid`) → **no se devuelve**, salvo con el motivo con nombre de
  arriba. La cita queda `cancelled` + `paymentStatus: 'paid'`: esa combinación es la
  consulta que localiza el dinero que la consulta tiene que decidir. Si lo devuelve
  desde Stripe, el webhook `charge.refunded` lo apunta (`refunded` si es total;
  parcial, la cita sigue pagada).
- **Ya cobrado por una cita que ya no existía** (la excepción) → se devuelve con
  `refundPayment` **sin importe**, para que Stripe devuelva lo que QUEDE del cobro (si
  ya hubo una devolución parcial a mano, pedir el total lo rechazaría entero). La cita
  queda `refunded` si no queda nada por devolver. Es best-effort, como todo lo demás de
  aquí: si Stripe no contesta, se queda `paid` y con su línea en el log.

> **El agujero que esto tapó (2026-07-29):** de las cinco vías de cancelación, el
> `DELETE` del panel era la ÚNICA que no liquidaba nada — cancelaba, auditaba y
> avisaba, pero el dinero se quedaba donde estuviera. Y `decidirReembolso` corta en su
> primera puerta si no consta `paid`, así que las retenidas ni se miraban: el paciente
> se quedaba con el importe bloqueado hasta que caducara solo. La decisión se toma
> DENTRO del helper, no en cada llamante, para que ninguna vía futura pueda olvidarse.

> **Histórico (29/07 – 07/08/2026):** hubo devolución automática íntegra si cancelaba
> la profesional, o el paciente con 24 h o más de antelación (`scheduledAt - now >=
> 24h`, sin problema de husos por ser `timestamptz`); <24 h y no-show, sin devolución.
> El código que llamaba a Stripe **se borró, no se apagó con un flag**: media política
> es la que acaba devolviendo dinero el día que alguien toca el interruptor sin querer.
> Si vuelve a hacer falta, está en el historial (commit del 07/08/2026) con su porqué.
> La frontera de las 24 h sobrevive como `HORAS_PARA_CANCELACION_TARDIA` y hoy solo la
> usa `packs.js` para dar por gastada una sesión de bono cancelada a última hora.

---

## 5. Riesgos y mitigaciones

De 25 riesgos revisados adversarialmente, los que **cambian el diseño**:

| Riesgo | Mitigación |
| --- | --- |
| **Dos clientes pagan el mismo hueco** | Comprobar en código no basta (hay carrera). Bloqueo en la transacción de reserva; a futuro, constraint `EXCLUDE` con rangos temporales en PostgreSQL. Ojo: un `UNIQUE(scheduledAt)` **no** cubre solapamientos parciales (10:00/60min vs 10:30/45min) |
| **Doble cobro** por webhook reintentado | Tabla `stripe_webhook_events` con `stripe_event_id` **UNIQUE** → el reintento se ignora. Stripe reintenta durante 3 días |
| **Stripe cobra pero la cita ya no está en pie** (se canceló mientras se capturaba) | Desde el 20/08 **sí se devuelve**, y es la única excepción a §4: el cobro es un fallo nuestro por una carrera y la cita ya no existe. Queda auditado como `citas.booking_confirm_tarde` con lo cobrado y lo devuelto, y el 409 dice lo que ha pasado de verdad con el dinero (si la devolución falla, no promete que ha vuelto). *(Histórico: 07–20/08, no se devolvía y el mensaje decía que sí.)* |
| **Retención que caduca sin que nadie mire** | `scripts/vigilar-retenciones.js` cada hora (`lib/citas/caducidadRetencion.js`): avisa a 36 h y a 6 h, y reconcilia con Stripe las ya muertas para que el panel no enseñe «Retenido» sobre un dinero que no existe |
| **Bloqueo de agenda** con reservas fantasma | Hold corto: **20 min** para meter la tarjeta (`VENTANA_TARJETA_MS`, `lib/payments/autorizacion.js`) y **45 min** cuando se va a Checkout por un bono (`HOLD_WINDOW_MS`, siempre por encima de los 31 min que vive la página de Stripe) + el endpoint es público, 30 req/min por IP |
| **Precio cambiado entre reservar y pagar** | `amountSnapshot` en la sesión; el webhook valida que el importe cobrado coincide |
| **Tenant `demo` cobrando de verdad** | `assertNotDemoPaidCall` (ya existe en `lib/demo/isDemo.js`) + demo nunca tiene claves Stripe |
| **Secretos en logs** | Nunca loguear el objeto de Stripe ni las claves; redactar antes de escribir |

---

## 5.bis Cómo se prueba esto (2026-07-29)

(Al día el 19/08/2026.) Desde el 18/08/2026 hay `npm test` (`scripts/pruebas.mjs`): recoge los `_smoke-*.mjs`
y lanza solo los que no necesitan base ni servidor; `npm run test:todo` el resto. Las
de pagos que necesitan Stripe ejercitan el código de verdad contra Stripe en **modo
prueba** y comprueban la base de datos. **No hace falta la CLI de Stripe**: el SDK
firma eventos de webhook con el mismo secreto del tenant, que es lo que hace `stripe
listen`. **Histórico:** hasta el 18/08 no había framework; eran scripts sueltos.

| Script | Qué fija |
| --- | --- |
| *(en `npm test`, sin nada encendido)* | |
| `_smoke-no-se-devuelve.mjs` | **la regla de negocio de §4**: nadie recupera el dinero solo, una retención sí se suelta, ningún mensaje del portal promete devolución |
| `_smoke-fraccionado.mjs` | `amount` es la PRIMERA CUOTA y no el total; de quién es cada `invoice.paid` |
| `_smoke-packs-sesiones.mjs` | qué estados gastan sesión de un bono (frontera de las 24 h, falta justificada), que las futuras reservan, que los números no se reciclan |
| `_smoke-pedir-otra-tarjeta.mjs` | la guarda del botón «pedirle otra tarjeta» (`estorbaParaPedirOtraTarjeta`), seis casos; «no lo sé» nunca es vía libre |
| *(con base de datos)* | |
| `_smoke-autorizacion.mjs` | retener → cobrar → soltar, y los casos límite (doble captura, doble liberación, capturar lo caducado) |
| `_smoke-ocupa-hueco.mjs` | qué citas bloquean su hora, en 11 estados. **Lleva un control** que exige que el filtro nuevo dé un veredicto distinto al viejo: sin él, la prueba pasaría sin probar nada |
| `_smoke-packs-reserva.mjs` | la reserva se engancha al bono por correo y se numera; un bono agotado o anulado no engancha; con dos, gasta el más antiguo |
| `_smoke-retencion-viva-o-muerta.mjs` | los cinco desenlaces de preguntarle a Stripe por la retención vieja, falseando la LIBRERÍA (`--import ./scripts/_fake-stripe-loader.mjs`) |
| `_smoke-fraccionado-reloj.mjs` | con un reloj de prueba de Stripe, que el tope de cuotas FRENA de verdad en la 4ª (solo claves `sk_test_`) |
| *(con servidor `npm run dev` y base)* | |
| `_smoke-book-autorizacion.mjs` | `POST /book` por HTTP y, sobre todo, que el **doble clic no cree dos retenciones** |
| `_smoke-webhook-retencion.mjs` | el webhook mete la solicitud en la lista de espera; idempotencia y firma falsa |
| `_smoke-confirmar-cobrar.mjs` | confirmar cobra y rechazar suelta, con sesión de admin. Fija **la regla de oro**: sin dinero, la cita NO se confirma |
| `_smoke-cancelar-retencion.mjs` | cancelar suelta el dinero por todas las vías. Su paso 3 comprueba que lo ya cobrado se QUEDA cobrado al cancelar desde el panel (esa vía no pasa el motivo con nombre, así que no entra en la excepción); puesto al día el 20/08/2026, antes esperaba la devolución de julio |
| `_smoke-carreras-cobro.mjs` | dos confirmaciones a la vez → un solo cobro; cita pegada en `capturing` → el vigilante la desatasca. Su caso 2 («el paciente cancela mientras se le cobra») acepta los TRES finales posibles desde el 20/08/2026: retención suelta (`void`), cobro devuelto por la excepción (`refunded`, mirando `amount_refunded` del cargo, que `amount_received` no baja al devolver) o pendiente de devolver a mano (`paid`) |
| `_smoke-pedir-tarjeta.mjs` | el enlace de «pedir otra tarjeta» abre el formulario de SU cita, la solicitud no desaparece de la lista mientras espera, y un token ajeno o manipulado no abre nada |
| `_smoke-vigilar-retenciones.mjs` | el vigilante avisa una vez por nivel, reconcilia las muertas y no toca las que Stripe dice vivas |
| `_smoke-dinero-solo-direccion.mjs` | el importe y el estado de cobro NO viajan en el JSON al equipo con rol `user` |
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

| Fase | Contenido | Qué pasó |
| --- | --- | --- |
| **1** | Capa de pagos: modelo `payment_sessions`, `stripeConfig`, checkout, webhook, refund, migración | Hecha |
| **2** | `price` en `EventType` + UI para que Laura ponga precios | Hecha |
| **3** | Reserva con pago: hold, caducidad perezosa, quitar lista de espera | Hecha salvo lo último: la lista de espera **no se quitó** — el 29/07 se cambió a RETENCIÓN y la profesional decide (§3) |
| **4** | Reembolsos automáticos (24 h / Laura / no-show) | **Histórico:** se construyó el 29/07 y **se retiró el 07/08/2026** (§4). Hoy no hay devolución automática |
| **5** | UI: precio en el widget, importe y estado en "Mis citas", estado de pago en el panel | Hecha; el aviso de «<24 h» ya no habla de devolución, solo de sesión de bono gastada |
| **6** | E2E en modo test → claves reales → producción | Hecha: nutri_laura cobra en producción |
| *después* | Bonos y pago a plazos (04-05/08), vigilante de retenciones, «quién ve el dinero» (07/08), pedir otra tarjeta (13/08) | Ver §2.3 y `citas.md` |

**Fuera del alcance inicial** (a propósito): captcha, reembolsos parciales, botón de
resincronizar pagos con webhook perdido.

Las fases 1-5 se desarrollaron y probaron enteras con el **modo test** de Stripe. La
cuenta real de Laura solo hizo falta en la fase 6.

---

## 7. Qué tiene que hacer Laura

1. **Abrir cuenta en Stripe** a su nombre/NIF (verificación de identidad + cuenta
   bancaria; puede tardar de horas a un par de días).
2. **Decidir el precio** de cada tipo de cita.
3. **Tener clara la política de cancelación** (la que aplica el CRM desde el
   07/08/2026, §4): cancelar una cita pagada **no devuelve nada automáticamente** — la
   sesión se cancela y se le da otra fecha; si el centro decide devolver, lo hace a
   mano desde Stripe. Una sesión de bono cancelada con menos de 24 h cuenta como
   gastada (es lo que firma en el Anexo I del contrato, ver `citas.md`).
   > **Histórico (hasta 07/08/2026):** el texto que se validó entonces era «Puedes
   > cancelar hasta 24 horas antes y se te devolverá el importe íntegro
   > automáticamente…». Ya no es lo que hace el sistema; no enseñarlo.
4. Opcional: solicitar **Klarna** y mirar si tiene **Bizum** en su panel. Ojo: con la
   RETENCIÓN solo funciona **tarjeta** (§2.3), y el fraccionado también; Klarna/Bizum
   solo servirían para el Checkout de un bono de pago único.

> Fiscal: se decidió que la cita **no genera factura**. Conviene que su gestoría
> confirme si necesita emitir al menos factura simplificada por estos cobros; el módulo
> de facturación ya existe y podría engancharse más adelante.
