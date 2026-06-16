# Módulo Citas

## Resumen

Módulo de agendamiento de citas con calendario, tipos de cita (EventType),
bloques de disponibilidad (Availability) y reservas (Booking). Tiene una
landing pública embebible (`/widget/c/[tenantSlug]`) que crea reservas
sin auth + endpoints admin bajo `/api/citas/*`.

Tenants que lo usan hoy: `nutri_laura` (única con flujo activo en
producción tras Fase 1).

## Modelos

- `EventType` — tipo de servicio reservable (Primera consulta, Seguimiento,
  etc.) con duración, buffers, modalidades, antelación mínima, etc.
- `Availability` — bloque horario recurrente por día de la semana,
  filtrable por EventType.
- `Booking` — reserva concreta con snapshot de duración/meetUrl,
  `cancellationToken` (UUID público para cancelar desde email),
  `status` ENUM `pending|confirmed|completed|cancelled|no_show`.

Asociaciones: `EventType.hasMany(Booking)`. **`Booking` NO tiene FK a
`Client`** — el cruce con la ficha del paciente es por `clientEmail`
(decisión arquitectónica explícita).

## Estados y transiciones

Diagrama lógico de estados:

```
             [creación: público con autoConfirm=false]
                      ↓
                  ┌────────┐
                  │pending │ ──── confirm() ────► confirmed
                  └────────┘                          │
                      │                               │
                      └──── reject(reason) ───┐       │
                                              ▼       ▼
                                          cancelled   │
                                                      │
                                                      ├─→ completed
                                                      ├─→ no_show
                                                      └─→ cancelled
                  ┌────────┐
                  │confirmed│  ←── [creación: público con autoConfirm=true
                  └────────┘                          o admin manual]
```

Tabla de transiciones permitidas:

| Estado origen | Acción | Estado destino | Endpoint |
|---|---|---|---|
| (creación pública) | flag `autoConfirmPublicBookings=true` (default) | `confirmed` | `POST /api/public/c/[slug]/book` |
| (creación pública) | flag `autoConfirmPublicBookings=false` (nutri_laura) | `pending` | `POST /api/public/c/[slug]/book` |
| (creación admin) | siempre | `confirmed` | `POST /api/citas/bookings` |
| `pending` | confirmar | `confirmed` | `PATCH /api/citas/bookings/[id]/confirm` |
| `pending` | rechazar | `cancelled` | `PATCH /api/citas/bookings/[id]/reject` |
| `confirmed` | marcar realizada | `completed` | `PATCH /api/citas/bookings/[id]` |
| `confirmed` | no asistió | `no_show` | `PATCH /api/citas/bookings/[id]` |
| `confirmed` | cancelar | `cancelled` | `PATCH /api/citas/bookings/[id]` o `DELETE` |
| cualquiera → `pending` | **prohibido** | — | 403 desde PATCH base |

### Por qué no se permite regresión a `pending`

Una cita confirmada/completada/cancelada **NO puede volver a `pending`**.
Razones:

1. El paciente ya recibió `bookingConfirmed` (auto-confirm) o un email de
   estado terminal. Volver a pendiente dispararía emails contradictorios.
2. La lista de espera se entiende como buzón de **solicitudes nuevas**,
   no como "papelera de citas reactivables".
3. Una cancelación dudosa o un cambio de fecha se gestionan con los
   estados existentes (cancelar + crear nueva pending si el paciente
   re-solicita).

El `PATCH /api/citas/bookings/[id]` base devuelve **403** con mensaje
`"Una cita no puede volver al estado pendiente una vez confirmada o procesada."`
si se intenta esa transición.

### `/reject` vs cancelación de cita confirmada

Conceptualmente son operaciones distintas:

- **`/reject`**: Laura mira una solicitud en lista de espera y dice "no
  acepto este caso / no tengo hueco / no encaja". El paciente nunca llegó
  a ser confirmado; recibe email `bookingRejected` ("Sobre tu solicitud
  de cita").
- **Cancelar confirmada**: Laura tenía la cita en agenda y se cae —
  enfermedad, viaje, paciente avisa que no puede. Es PATCH base con
  `{ status: "cancelled" }` o `DELETE`. (Hoy NO dispara email
  automático; pendiente backlog si quieres "tu cita ha sido cancelada"
  como template separado.)

Ambas marcan `status="cancelled"` y rellenan `cancelledAt` +
`cancellationReason`, pero el endpoint y el email asociado distinguen
la intención.

### Cancelación pública por el paciente

Existe `cancellationToken` (UUID por booking) usado por el email
`bookingConfirmed`. La URL `/widget/c/[slug]/cancel/{token}` deja al
paciente cancelar él mismo desde el email sin auth. Endpoint admin
equivalente: `PATCH /api/citas/bookings/[id]` con `{ status: "cancelled" }`.

## Feature flag: `autoConfirmPublicBookings`

Vive en `master.tenant_modules.feature_flags` del módulo `citas`.

- **Ausente o `true`** (default): bookings desde el formulario público
  nacen `confirmed`. El paciente recibe `bookingConfirmed` inmediato.
- **`false`**: bookings nacen `pending`. El paciente recibe
  `bookingReceived` ("hemos recibido tu solicitud"). Laura confirma
  desde la lista de espera y entonces se dispara `bookingConfirmed`.

Hoy solo `nutri_laura` tiene el flag en `false` (script
`scripts/migrate-booking-pending.js` lo aplica como parte de la
migración). Otros tenants conservan el comportamiento histórico.

## Endpoints

### Públicos (sin auth, rate-limited)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/public/c/[tenantSlug]/info` | GET | Metadatos del tenant + branding |
| `/api/public/c/[tenantSlug]/event-types` | GET | Tipos de cita activos |
| `/api/public/c/[tenantSlug]/availability` | GET | Slots disponibles |
| `/api/public/c/[tenantSlug]/book` | POST | Crear booking (lee flag autoConfirm) |
| `/api/public/c/[tenantSlug]/booking/[token]` | GET | Detalle desde token |
| `/api/public/c/[tenantSlug]/cancel/[token]` | POST | Cancelar desde token |

### Admin (JWT + `hasModule(citas)`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/citas/event-types` | GET/POST | Listar / crear EventType |
| `/api/citas/event-types/[id]` | GET/PATCH | CRUD individual |
| `/api/citas/availability` | GET/POST | Listar / crear bloque |
| `/api/citas/availability/[id]` | GET/PATCH/DELETE | CRUD bloque |
| `/api/citas/availability/bulk` | POST | Operación masiva |
| `/api/citas/bookings` | GET | Listar paginado. Filtros: `from`, `to`, `future`, `status`, `eventTypeId`, `clientEmail`, `search` |
| `/api/citas/bookings` | POST | Crear booking manual (default `confirmed`) |
| `/api/citas/bookings/[id]` | GET/PATCH/DELETE | CRUD. PATCH bloquea regresión a `pending` |
| `/api/citas/bookings/[id]/confirm` | PATCH | Transición `pending → confirmed`. Idempotente. Valida solapamiento. Dispara `bookingConfirmed` |
| `/api/citas/bookings/[id]/reject` | PATCH | Transición `pending → cancelled`. Acepta `cancellationReason` en body. Dispara `bookingRejected` |
| `/api/citas/bookings/calendar` | GET | JSON FullCalendar para la vista mensual |

## UI

### Default (vanilla)

`modules/default/CitasModule.jsx` — calendario FullCalendar con modal
"Nueva cita manual" + modal detalle con acciones marcar completada / no
asistió / cancelar. Sin tabs ni lista de espera (los otros tenants no
usan `pending` hoy).

### Override nutri_laura

`modules/overrides/nutri-laura/CitasModule.jsx` — dos tabs:

1. **Lista de espera** (tab default si hay pendings):
   - Cards por solicitud con nombre, contacto, servicio, fecha
     propuesta, modalidad y respuesta al formulario.
   - Acciones "Confirmar" (dialog "¿Confirmar cita con {nombre} el
     {fecha}?") y "Rechazar" (textarea opcional para motivo).
   - Tras la acción, la fila desaparece y los emails salen automáticos.
2. **Calendario**: vista FullCalendar simplificada. Modal de detalle
   solo lectura — la edición pasa por el flujo de lista de espera o
   por el detalle base.

Badge contador de pendientes en el tab.

## Integración Google Calendar / Meet — **Fase 2 (no implementado)**

El campo `Booking.meetUrl` es un snapshot del `EventType.meetUrl`
configurado manualmente (URL Meet estática). Para Fase 2 la integración
generará Meet links reales vía Google Calendar API por cita y los
emails llevarán el link dinámico. Variables env placeholder ya
añadidas a `.env.production.example` (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`).

## Migraciones aplicadas (sprint Fase 1)

- `scripts/migrate-booking-pending.js`: añade `'pending'` al enum
  `enum_bookings_status` en todos los tenants con módulo citas
  habilitado. Setea `featureFlags.autoConfirmPublicBookings=false` en
  `nutri_laura.citas`. Idempotente.

## Backlog

- Endpoint atómico server-side para confirm/reject (hoy: PATCH +
  sendEmail no transaccional; si Resend cae, el estado cambia pero el
  email no se envía).
- Reintentos persistentes para emails fallidos (apuntar a `email_send_log`
  o n8n cola).
- Email "tu cita ha sido cancelada" cuando se cancela una confirmada
  (hoy solo el reject manda email).
- FK física `Booking.clientId → clients.id` opcional, con merge por
  email al crear bookings desde formulario público (decisión
  arquitectónica pendiente: hoy hay `clientEmail` libre).
- Integración Google Calendar real (Fase 2).
