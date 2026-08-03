# Módulo Citas

## Resumen

Módulo de agendamiento de citas con calendario, tipos de cita (EventType),
bloques de disponibilidad (Availability) y reservas (Booking). Tiene una
landing pública embebible (`/widget/c/[tenantSlug]`) que crea reservas
sin auth + endpoints admin bajo `/api/citas/*`.

Tenants que lo usan hoy: `nutri_laura` (única con flujo activo en
producción tras Fase 1).

---

## Puerta de admisión: quién puede reservar (2026-08-03)

La agenda pública no miraba la bandeja de solicitudes: **cualquiera con el
enlace del widget reservaba**, hubiera pasado o no por el formulario de primer
contacto. Con retención de tarjeta de por medio es peor, porque se le bloquea
dinero a alguien a quien la profesional no ha admitido.

`lib/citas/puertaFormulario.js` decide, y lo comparten `/book` (que corta) y
`/info` (que lo anuncia por delante, para que nadie rellene la reserva entera
para nada).

| Ajuste | Dónde | Por defecto |
| --- | --- | --- |
| `settings.citas.formularioObligatorio` | Configuración → Citas | `false` |
| `settings.citas.formularioUrl` | ídem (el formulario vive en la web del cliente) | — |

Reglas, decididas por el usuario: se aplica **a todos** —también a quien ya era
paciente, que está avisado— y **a todos los tipos de cita**. No es una puerta
cerrada: se enseña el aviso con el enlace.

Estados que devuelve `estadoDeAdmision`: `aceptada` (pasa), `pendiente`,
`descartada`, `sin_enviar` y `sin_bandeja`. Detalles que se rompen solos y por
eso están fijados en `_smoke-puerta-formulario.mjs`:

- **Una aceptada manda sobre el resto.** Quien fue admitido y luego manda otra
  solicitud no vuelve a la cola.
- **El correo se cruza con `iLike`**: nadie escribe su email dos veces igual.
- **A un anónimo no se le dice si un correo está pendiente o no existe.** Sería
  un buscador de pacientes de la consulta. La diferencia solo se cuenta a quien
  llega con sesión verificada del portal.
- **Tener el módulo no garantiza tener la tabla** (en local `nutri_laura` tenía
  `formularios` sin `form_submissions`). Si no se puede consultar la bandeja se
  cierra, no se abre, y lo canta `scripts/comprobar-citas.js`.
- El enlace viaja en el **cuerpo** de la respuesta, no en `details`, que
  `apiResponse.error()` borra en producción. Para eso está `errorConDatos`.

⚠️ Con la puerta encendida en local, **todas las demás smokes de citas fallan a
la vez**: reservan con correos de prueba que nunca han pasado por el formulario.

---

## Decirle algo al cliente: las tres vías (2026-08-03)

El CRM sabía avisar de lo que le pasa a **una cita**, y solo de algunas cosas.
Repaso de qué había y qué falta ya no:

| Qué pasa | Correo | En el portal |
| --- | --- | --- |
| Se **cancela** la cita | ✅ ya existía | ✅ el estado pasa a «Cancelada» |
| Se **mueve** de día u hora | ➕ **nuevo** (`bookingRescheduled`) | ✅ la ficha enseña la fecha nueva |
| Cualquier **aviso** («tráete los análisis») | ➕ **nuevo** (`avisoCliente`) | ➕ **nuevo**: sección «Avisos» |

### El cambio de hora no avisaba a nadie

Era el hueco más silencioso: cancelar sí escribía, cambiar la hora no. La cita
aparecía otro día en el portal y el paciente solo se enteraba si entraba a
mirar. **La gente se presenta el día que le dijeron, no el que pone en una
pantalla que no ha abierto.** El correo enseña las DOS fechas, porque decir solo
la nueva obliga a recordar cuál era la anterior. Admite `motivoCambio` opcional.

### Avisos del centro (`client_notices`)

Para todo lo que no es un cambio de la cita. Un aviso hace dos cosas: **sale por
correo Y queda publicado en el portal**. Lo segundo importa más de lo que
parece — el correo se pierde entre otros cincuenta y el portal sigue ahí en
enero.

- **La clave es el EMAIL, no `clientId`.** Es como identifica el portal (sesión
  SSO de WordPress), igual que `citas-portal/bookings`. Colgarlo de la ficha lo
  haría invisible para quien reserva por la web sin tener ficha, y los
  `client_id` son nullable y a menudo están vacíos.
- **Se guarda aunque el correo no salga.** `emailStatus` registra qué pasó
  (`enviado` / `sin_configurar` / `sin_consentimiento` / `error`) y el panel se
  lo dice a quien lo escribió: «publicado en su área privada, pero NO ha salido
  por email». El aviso vale igual, porque el portal lo enseña.
- **El portal solo devuelve lo suyo**: el `where` va siempre atado al email del
  token, nunca a un id que venga del cliente. Marcar el aviso de otro no hace
  nada aunque se sepa su id, y no se re-marca lo ya leído.
- Respeta las preferencias de comunicación de la familia (`citaPuedeAvisar`).
- Auditado con **resumen**, nunca el texto: lo que se le escribe a un paciente
  puede llevar datos de salud y `master.audit_log` lo comparten todos los
  clientes.

---

## «Guardar y enviar» no puede mentir (2026-08-03)

`sendEmail` devuelve `{ok: true, dryRun: true}` cuando no hay clave de Resend:
no lanza excepción **a propósito**, para que en desarrollo no se caiga media
aplicación por una clave que falta. El efecto secundario es que un
`await sendEmail(...)` a secas parece haber funcionado siempre.

Con eso, el panel decía **«✓ Enlace enviado por email al cliente»** con el buzón
del paciente vacío — y como en producción no hay ninguna clave de Resend
configurada, eso es lo que habría pasado el primer día. El mensaje alternativo
además sugería una causa falsa: «revisa que la cita sea online y no esté
cancelada».

`envioRealizado(resultado, etiqueta)` en `lib/email/resendClient.js` interpreta
la respuesta y devuelve `{salio, motivo}` (`ok` | `sin_configurar` | `error`),
además de dejar una línea en el log cuando no sale. Lo usan los seis envíos de
citas; el del enlace de videollamada devuelve además `emailMotivo` al panel,
que ya distingue entre *falta configurar el correo*, *el cliente no quiere
avisos* y *el envío falló*.

**El enlace se guarda siempre**, salga el correo o no: son dos cosas distintas y
la que importa es que quede en la cita.

---

## La sala fija es opcional (2026-08-03)

`validateModalityFields` exigía `meetUrl` para cualquier tipo de cita con
modalidad online. Contradecía al propio módulo: el modo por defecto —y el
recomendado— es el **manual**, en el que el enlace se crea cuando toca y se pega
en esa cita. Pedir por adelantado una sala permanente que casi nadie tiene solo
conseguía que se escribiera cualquier cosa para poder guardar: así aparecieron
en `nutri_laura` dos enlaces de mentira que habrían llegado a pacientes reales
el día que alguien pasara a modo automático.

**Un campo obligatorio que el sistema después ignora no protege de nada:
fabrica datos falsos.** `location` (presencial) y `phoneNumber` (teléfono)
siguen siendo obligatorios, porque ahí no hay un segundo momento para darlos —
quien reserva presencial necesita saber adónde ir desde ya.

---

## ¿Le funcionan las citas a este cliente? (`scripts/comprobar-citas.js`)

Solo lectura. Que las citas funcionen depende de ocho cosas repartidas entre BD,
ajustes y claves de terceros, y **casi todas fallan en silencio**: sin clave de
Resend el CRM no da error, se pone en dry-run; sin `price` no se pide tarjeta;
con el modo de videollamada en automático y un enlace de ejemplo, el paciente
recibe una sala que no existe. El script pregunta por todo a la vez y dice qué
falta y **quién lo pone** (clave del cliente o cosa nuestra).

```bash
docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura
```

Sin slug recorre todos los tenants activos con el módulo. Devuelve código 1 si
algo falta, así que sirve de comprobación tras cada despliegue que toque citas.

---

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

## Avisos por WhatsApp (01/08/2026)

Además del correo, los avisos de cita pueden salir por WhatsApp desde el número
del propio negocio (Meta Cloud API, BYOK: credenciales y gasto del cliente).

- Interruptor por cliente: `settings.citas.avisosWhatsapp`, **apagado por
  defecto**, en Configuración. Sin las credenciales de Meta no manda nada y la
  tarjeta lo dice.
- Enganchado en tres sitios: «Guardar y enviar» del enlace de videollamada,
  confirmación de la cita y recordatorio de la víspera.
- **Manda lo que haya marcado la familia** (01/08): los avisos de cita, por
  correo Y por WhatsApp, solo salen si la familia aceptó ese canal en su área
  privada — ver `docs/modules/clients.md` → «Comunicaciones». Si desmarca los
  dos, no se le escribe por ninguno.
- Lógica en `lib/citas/avisosWhatsapp.js`; el envío HTTP en
  `lib/whatsapp/whatsappConfig.js`. **Tres condiciones**: credenciales +
  interruptor + que la familia no lo haya denegado (`Patient.consents.whatsapp`).
  Si el consentimiento no se puede comprobar, NO se manda: ante la duda, callar
  sale más barato que escribir a quien dijo que no.
- Nunca lanza: el correo sigue siendo el canal principal y un WhatsApp que falla
  no puede tumbar la cita. El PATCH del enlace devuelve `whatsappEnviado` y
  `whatsappMotivo` para poder explicarlo en pantalla.
- ⚠️ Meta cobra por conversación iniciada por el negocio y, fuera de la ventana
  de 24 h, exige **plantilla aprobada**: los textos planos los rechaza. Hasta
  tener plantillas dadas de alta, esto sirve para responder dentro de esa
  ventana.

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

- **Sin Contrato del Centro subido no se pide nada**: si el tenant no tiene
  documento `contract_template`, no hay pantalla ni bloqueo. Subirlo es la
  señal de que el centro quiere exigir la firma. (Arreglo del 31/07: sin esta
  condición, el cerrojo se activaba con solo tener el portal encendido y a los
  pacientes de nutri_laura —el único tenant con portal— les apareció una
  pantalla pidiendo firmar un documento que no existe.)
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
