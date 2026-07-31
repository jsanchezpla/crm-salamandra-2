# Módulo Citas

## Resumen

Módulo de agendamiento de citas con calendario, tipos de cita (EventType),
bloques de disponibilidad (Availability) y reservas (Booking). Tiene una
landing pública embebible (`/widget/c/[tenantSlug]`) que crea reservas
sin auth + endpoints admin bajo `/api/citas/*`.

Tenants que lo usan hoy: `nutri_laura` (única con flujo activo en
producción tras Fase 1).



## Informe de ocupación y ausencias (2026-07-27)

`/equipo/ocupacion` (hijo adminOnly del grupo Equipo, `moduleKey: citas`):
cuántas citas hubo en el mes, cuántas se atendieron, cuántas se cancelaron y a
cuántas NO SE PRESENTÓ NADIE, por profesional, más el reparto por tipo de cita.
El estado `no_show` existía desde el principio pero no se agregaba en ninguna
pantalla: había que contarlo cita a cita.

- API: `GET /api/citas/informe-ocupacion?periodo=YYYY-MM` (solo admin con rol
  fresco de BD; sin periodo usa el mes en curso EN MADRID, no el del servidor).
- **La tasa de ausencias se calcula sobre las citas que llegaron a su hora**
  (atendidas + no presentadas). Las canceladas con aviso NO cuentan: avisar a
  tiempo es justo lo que se quiere fomentar, penalizarlo sería absurdo.
- Semáforo: verde <8%, ámbar 8-15%, rojo ≥15%.

## Recordatorio de cita (2026-07-27)

Correo automático la víspera. **Apagado por defecto**: se enciende por cliente
en Configuración (`settings.citas.recordatorios`), porque encenderlo empieza a
mandar correos a pacientes reales.

- Lógica: `lib/citas/recordatorios.js`; plantilla
  `lib/email/templates/citas/bookingReminder.js` (lleva SIEMPRE el enlace de
  cancelación: el objetivo es que quien no pueda venir lo diga a tiempo y el
  hueco se libere).
- Ejecutor: `scripts/enviar-recordatorios.js`, lanzado cada hora por el
  temporizador de systemd `scripts/deploy/crm-recordatorios.timer`. Con
  `--simular` no manda nada y dice a cuántos escribiría.
- Ventana ancha (18-30h antes) para que ninguna cita se escape por el borde
  entre pasadas; `bookings.reminder_sent_at` (migración
  `migrate-booking-reminder`) garantiza UNO por persona.
- Solo citas **confirmadas**, futuras y con email. Las pendientes de confirmar
  no reciben recordatorio (todavía no hay nada que recordar).
- La marca se pone DESPUÉS de enviar: si el correo falla, se reintenta en la
  pasada siguiente en vez de dar por avisada a una persona que no lo está.
- URL pública de los enlaces: `APP_PUBLIC_URL` (por defecto el dominio del CRM).

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

### Portal de la familia (sesión SSO, `Authorization: Bearer`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/public/c/[tenantSlug]/citas-portal/session` | POST | Canjea el `wpsso` de WordPress por sesión del portal |
| `/api/public/c/[tenantSlug]/citas-portal/bookings` | GET | Citas de quien ha entrado |
| `/api/public/c/[tenantSlug]/citas-portal/cancel/[id]` | POST | Cancelar su cita |
| `/api/public/c/[tenantSlug]/citas-portal/documents` | GET/POST | «Mis documentos» (cerrado si falta firmar el contrato) |
| `/api/public/c/[tenantSlug]/citas-portal/documents/[id]` | GET | Descarga de un documento suyo |
| `/api/public/c/[tenantSlug]/citas-portal/contract` | GET | Estado del Contrato del Centro (ver abajo) |
| `/api/public/c/[tenantSlug]/citas-portal/contract/sign` | POST | Firma dibujada `{ signature: dataURL PNG }` |
| `/api/public/c/[tenantSlug]/citas-portal/contract/documento` | GET | PDF del contrato, para leerlo antes de firmar |

## Contrato del Centro en el portal (sprint Aumenta 2026-07, 2.1 y 2.2)

Al entrar al portal, lo PRIMERO es el contrato: si falta la firma de quien
entra, `ContratoGate.jsx` tapa la pantalla entera. Hay un «Lo firmo más tarde»
que deja pasar a ver las citas, pero **«Mis documentos» sigue cerrado** —ni
consultar ni subir— hasta que firmen todos (decisión de Rodrigo, 31/07). El
aplazamiento dura lo que la pestaña: al volver a entrar, el contrato vuelve a
salir.

- **Quién firma**: los tutores marcados como firmantes en la ficha
  (`Client.guardians`). Si la ficha no tiene tutores, firma el **titular** —
  `effectiveSigners()` en `lib/clients/clientContract.js`—. Sin ese respaldo,
  «no hay firmantes» dejaría a la familia encerrada en una puerta sin llave.
- **Qué firma**: el contrato estándar del centro
  (`documents.source='contract_template'`). Si el equipo ya subió a la ficha el
  contrato firmado en **papel**, cuenta como firmado y no se pide firma web.
- **Padres separados**: hacen falta las DOS firmas. El que ya firmó ve un aviso
  de que falta el otro, y la documentación sigue cerrada para ambos.
- **Qué se guarda** (`ContractSignature`): imagen PNG de la firma
  (`lib/clients/signatureStorage.js`, fuera del archivo de documentos), nombre
  del firmante en ese momento, fecha, IP y navegador. Índice único
  cliente+tutor: firmar dos veces no duplica nada.
- El cerrojo se aplica también en la **descarga individual** de documentos, no
  solo en el listado: si no, un enlace guardado seguiría abriendo el PDF.
- Lógica compartida en `lib/citas/portalContract.js` (los ficheros de rutas de
  Next solo deben exportar manejadores HTTP).

## Bloqueo mensual por impago (sprint Aumenta 2026-07, 2.3)

`settings.citas.portalBloqueoImpago`, **apagado por defecto** (interruptor en
Configuración). Con él encendido, la familia ve los documentos de un mes solo
si consta el cobro de ese mes:

- Mes abierto = existe un `Payment` **completado** con `periodMonth` de ese mes
  para esa familia, **o** el mes está en `Client.portalUnlockedMonths` (abierto
  a mano desde la ficha: becas, acuerdos de pago, cobros que entraron fuera del
  CRM). Regla única en `lib/citas/portalMeses.js`.
- **Nunca** se bloquea lo que subió la propia familia (`uploadedByClient`):
  retenerle sus analíticas por un recibo no es palanca de cobro.
- El portal **dice** qué meses tiene retenidos y cuántos documentos hay en cada
  uno; no los esconde en silencio. Nombres de fichero, no: el título de un
  informe clínico ya es información sensible.
- La misma regla se aplica en la descarga individual (un enlace guardado no
  puede saltarse el cerrojo).
- Se gestiona en la ficha del cliente → «Acceso al portal por meses»
  (`GET/PUT /api/clients/[id]/portal-months`, auditado).

⚠️ Encenderlo en un centro que NO registra los cobros con su mes esconde de
golpe la documentación de todas las familias. Por eso está apagado por defecto
y el interruptor lo avisa.

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

### Citas desde la ficha del paciente

Como complemento al módulo `/citas`, la **tab Citas del detalle de cliente**
(`/clientes/:id` → tab "Citas" en el override nutri_laura) lista los
bookings de ese paciente concreto y permite confirmar/rechazar
inline cualquier `pending`. Cruce por `clientEmail` (Booking no tiene FK
a Client).

Componente: `modules/overrides/nutri-laura/ClientBookingsPanel.jsx`.
Endpoints usados: idénticos a esta página (`GET /api/citas/bookings?clientEmail=`,
`PATCH .../confirm`, `PATCH .../reject`). Detalle del flujo y permisos en
[`docs/modules/clients.md`](./clients.md#override-nutri_laura).

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
