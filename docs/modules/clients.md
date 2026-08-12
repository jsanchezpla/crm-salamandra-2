# Módulo Clientes

## Resumen

Módulo genérico para gestionar clientes (o "pacientes", según el tenant)
del CRM. Cada tenant con `moduleKey="clients"` activado en
`master.tenant_modules` tiene su tabla `crm_{slug}.clients` y endpoints
bajo `/api/clients/*`.

Tenants que lo usan hoy: `spain_enzymes` (B2B), `nutri_laura` (B2C,
"pacientes"), `demo`, `retorika` (cuentas mínimas para asociar con
training).

### Cómo se llama el módulo en cada centro (04/08/2026)

`lib/clients/vocabulario.js` decide si esto se llama **Clientes** o
**Pacientes**, y lo dicen igual el sidebar, la pantalla `/clientes`, la
portada y el `<title>` del navegador. Se llama Pacientes donde el cliente ES
el paciente: **tiene `nutricion` y NO tiene `pacientes` ni `clinica`**.

Por MÓDULOS y no por slug, igual que `formularioAlta.js`. Y `pacientes` /
`clinica` mandan sobre `nutricion` a propósito: en un centro clínico el
cliente es la familia que paga y los pacientes son los hijos, que ya tienen
su tabla y su entrada de menú. Sin esa condición, Aumenta y demo tendrían dos
«Pacientes» distintos en el mismo sidebar. Hoy cumple solo `nutri_laura`.

## Modelo `Client`

Ver `models/tenant/Client.model.js` para la definición canónica de
campos. Resumen:

- `id` (UUID), `type` (individual|company, default company), `name`
  (obligatorio).
- Contacto: `email`, `phone`, `address` (JSONB).
- Fiscal: `taxId`, `fiscalName`, `fiscalAddress`, `fiscalCity`,
  `fiscalZip`, `fiscalCountry` (default `ES`).
- `status` ENUM `active|inactive|prospect` (default `active`).
- Portal: `portalAccess`, `portalEmail`.
- `notes` TEXT (notas rápidas en la propia ficha — distinto del
  timeline `ClientNote`).
- Familia (sprint Aumenta 2026-07): `separated` (padres separados),
  `guardians` JSONB (tutores, ver `lib/clients/guardians.js`),
  `portalUnlockedMonths` JSONB y `contractDocumentId` → contrato firmado
  de la familia (ver «Contrato del Centro» más abajo).
- `assignedTeamMemberId` (UUID → `team_members`, ON DELETE SET NULL) —
  su **profesional de referencia**: con quién lleva el seguimiento
  (06/08/2026). `null` = sin asignar, y entonces la agenda pública le
  enseña los huecos del centro enteros; asignado, solo los de esa
  persona (`lib/citas/horarioProfesional.js`). En una consulta externa
  es además **quién la ve**, junto con los admin
  (`lib/clients/consultaExterna.js`).
- `customFields` JSONB libre por tenant.

## Endpoints

| Ruta | Método | Descripción | Auth |
|---|---|---|---|
| `/api/clients` | GET | Listado paginado (filtros: search, status, country) | JWT + `hasModule(clients)` |
| `/api/clients` | POST | Crear cliente (acepta `customFields` libre + leadId/origin/seStatus) | JWT |
| `/api/clients/[id]` | GET | Detalle + interactions | JWT |
| `/api/clients/[id]` | PUT | Editar (merge `customFields`) | JWT |
| `/api/clients/[id]` | DELETE | Borrar. Bloquea si tiene facturas. **GC** del directorio físico de attachments | JWT |
| `/api/clients/[id]/interactions` | GET/POST | Timeline legacy de interacciones (call/email/meeting/note) | JWT |
| `/api/clients/[id]/notes` | GET/POST | Notas internas (ver sección abajo) | JWT |
| `/api/clients/[id]/notes/[noteId]` | DELETE | Borrar nota | JWT |
| `/api/clients/[id]/attachments` | GET/POST | Archivos PDF (ver sección abajo) | JWT |
| `/api/clients/[id]/attachments/[attachmentId]` | DELETE | Borrar attachment (BD + disco) | JWT |
| `/api/clients/[id]/attachments/[attachmentId]/download` | GET | Stream del PDF | JWT |
| `/api/clients/[id]/guardians` | GET/PUT | Padres/tutores de la familia + estado de firma | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contract` | GET/POST/DELETE | Contrato del Centro de la familia (PDF) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contract/download` | GET | Stream del PDF del contrato | JWT + `hasModule(clients)` |
| `/api/clients/[id]/portal-months` | GET/PUT | Meses abiertos del área privada (bloqueo por impago) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/projects` | GET | Proyectos del cliente | JWT + `hasModule(projects)` |
| `/api/clients/[id]/billing-summary` | GET | Resumen facturas | JWT + `hasModule(billing)` |
| `/api/clients/export` | GET | XLSX de listado | JWT |
| `/api/clients/import` | POST | Importar JSON | JWT |

## Conversión Lead → Cliente

El frontend (override por tenant) hace dos llamadas:

1. `POST /api/clients` con `{ name, email, phone, leadId: lead.id, origin: "lead", status, customFields }`.
2. `PATCH /api/leads/[id]` con `{ stage: "<won|paciente|...>", clientId: <id del cliente recién creado> }`.

Guard de idempotencia: si `lead.clientId` ya está seteado, el override
no crea un segundo cliente. Detalles del fix: ver `docs/modules/leads.md`
y los overrides `modules/overrides/{spain-enzymes,nutri-laura}/LeadsModule.jsx`.

Pendiente backlog: endpoint atómico server-side
`POST /api/leads/[id]/convert` con transacción real.

---

## Contrato del Centro (sprint Aumenta 2026-07, punto 1.1)

El contrato es de la **familia**, no del paciente: quien firma y quien paga son
los padres. Antes vivía en `patients.contract_file` y con dos hermanos en el
centro había **dos contratos para una sola familia**; con padres separados,
además, no se sabía cuál de los dos tutores había firmado.

- El PDF **no** tiene almacén propio: es una fila de `documents`
  (`source='contrato'`, `client_id` del pagador, `client_visible=true`) y
  `clients.contract_document_id` apunta a ella. Así aparece también en el
  buscador de Documentos y no hay un segundo almacén que mantener.
- Lógica compartida en `lib/clients/clientContract.js`. Si el puntero apunta a
  un documento borrado, cae al último `source='contrato'` de ese cliente: sin
  ese respaldo, borrar el documento desde el módulo Documentos dejaría la ficha
  diciendo «sin contrato» teniendo uno.
- Solo PDF, validado por **magic bytes** (`%PDF-`), 25 MB y cuota de tenant
  como cualquier documento.
- La **firma** es otra cosa (`ContractSignature` + `lib/clients/guardians.js`):
  este endpoint solo responde «¿hay contrato subido?» y de paso cuántas firmas
  faltan. Con padres separados hacen falta las dos. La firma web se hace en el
  portal de la familia — ver `docs/modules/citas.md` → «Contrato del Centro en
  el portal». **El contrato en papel subido aquí cuenta como firmado** y
  desactiva la firma web (decisión de Rodrigo, 31/07).
- **Quién firma**: los tutores marcados como firmantes; si la ficha no tiene
  tutores, el titular (`effectiveSigners()`). La lista de tutores se edita en
  la sección «Padres y tutores» de la ficha
  (`components/clients/ClientGuardiansSection.jsx`): el endpoint existía desde
  el 29/07 pero no había pantalla, así que en la práctica ninguna familia tenía
  tutores y el caso de los padres separados no se podía representar.
- UI: sección «Contrato» de la ficha de cliente
  (`components/clients/ClientContractSection.jsx`). Se esconde sola si el
  tenant no tiene la tabla `documents` (`archivoDisponible: false`).
- Auditoría: `client.contract.uploaded` / `client.contract.deleted` (solo
  nombre del fichero y tamaño — el contrato lleva datos personales y la
  auditoría vive en `master`, compartida).

**Migración de lo ya subido**: `scripts/migrate-contract-patient-to-client.js`
(ONE_OFF, dry-run por defecto, deja `.rollback.sql`). Mueve el contrato solo si
el paciente tiene cliente pagador; con dos hermanos con contrato mueve el más
reciente y lista el otro. El PDF se **copia** (el original sigue en
`{uploads}/{slug}/patients/{id}/`), así que el rollback no depende de ficheros.

`GET /api/pacientes/[id]/contract` sobrevive **solo como descarga** de los
contratos que la migración no pudo mover (pacientes sin cliente). Sus POST y
DELETE se retiraron.

---

## Comunicaciones: por dónde se le escribe a cada familia (01/08/2026)

`clients.communication_prefs` (JSONB, migración
`migrate-client-communication-prefs`). **Tres casillas** y ninguna más:

| Canal | Qué gobierna |
| --- | --- |
| `citasEmail` | Confirmaciones, recordatorios, cambios y cancelaciones **por correo** |
| `citasWhatsapp` | Los mismos avisos **por WhatsApp** |
| `novedades` | Publicidad del centro (talleres, charlas). **Nada que ver con las citas** |

Decisiones que sostienen esto (`lib/clients/comunicaciones.js`):

- **Vive en el CLIENTE, no en el paciente.** Quien recibe los mensajes es la
  familia y el área privada es suya. Con dos hermanos en el centro el teléfono
  es uno: preguntarlo dos veces sería absurdo y contestar distinto,
  irresoluble. Lo del NIÑO (imágenes) sigue en `patients.consents`.
- **Si desmarcan los dos canales de citas, NO se les escribe. Punto.**
  (Criterio de Rodrigo, 01/08.) No hay puerta trasera para "avisos
  imprescindibles": quien dice que no quiere correos no quiere correos. Sigue
  viendo sus citas entrando en el portal, que es suyo y no necesita permiso.
- **Solo un NO explícito bloquea.** Mientras no contesten valen los valores por
  defecto (correo sí, WhatsApp no): si no, activar esto habría dejado a todas
  las familias existentes sin confirmación de cita de un día para otro.
- **Publicidad separada y la pantalla se puede pasar con todo desmarcado**: si
  aceptar novedades fuera el peaje para entrar en tu área privada, ese
  consentimiento no valdría nada.

Dónde se marca:

- **La familia**, en su área privada: segundo paso al entrar, después de firmar
  el contrato (`ComunicacionesGate.jsx`, `GET/POST
  /api/public/c/[slug]/citas-portal/comunicaciones`). Se guarda con **fecha, IP
  y navegador**: es la prueba de que lo marcó ella.
- **El equipo**, en la ficha del cliente → «Comunicaciones»
  (`GET/PUT /api/clients/[id]/comunicaciones`), para cuando lo piden por
  teléfono. Retirar un consentimiento tiene que ser tan fácil como darlo. La UI
  distingue quién lo marcó (`portal` vs `equipo`): como prueba no es lo mismo.

Quien envía consulta `citaPuedeAvisar(tenantModels, booking, canal)`, que
resuelve la familia por `booking.clientId` y, si falta, por el correo de la
reserva. Sin ficha de cliente se aplica el valor por defecto del canal: una
reserva pública tiene que poder recibir su confirmación.

⚠️ `lib/citas/portalClient.js` tiene que traer `communicationPrefs` entre sus
atributos. Sequelize solo trae lo que se le pide: sin eso, el portal leía
`undefined` y enseñaba los valores por defecto dijera lo que dijera la familia
(pillado el 01/08, mismo tropiezo que tuvo el contrato con `contractDocumentId`).

---

## Archivos adjuntos

Sprint Fase 1 (junio 2026). Permite a Laura (y por extensión a cualquier
usuaria del módulo `clients`) subir PDFs asociados a un cliente —
informes, analíticas, planes, etc.

### Modelo `ClientAttachment`

```
id              UUID PK
clientId        UUID NOT NULL FK→clients(id) ON DELETE CASCADE
originalName    STRING(255) NOT NULL  -- nombre con que el usuario subió
storedFilename  STRING(255) NOT NULL  -- "{uuidv4}.pdf" generado por el backend
mimeType        STRING(100) NOT NULL  -- siempre "application/pdf" hoy
fileSize        INT NOT NULL          -- bytes
uploadedBy      STRING(255)           -- email del admin (X-User-Email)
createdAt       TIMESTAMPTZ
updatedAt       TIMESTAMPTZ
```

Índices: `client_id`, `created_at DESC`.

### Almacenamiento físico

- Ruta: `{UPLOADS_ROOT}/{tenantSlug}/clients/{clientId}/{storedFilename}`.
- `UPLOADS_ROOT`:
  - `process.env.UPLOADS_ROOT` si está definido (tests).
  - `/app/uploads` en producción (volumen Docker).
  - `<cwd>/uploads` en desarrollo (gitignorado).
- Producción: `docker-compose.yml` monta `${UPLOADS_HOST_DIR:-./uploads}:/app/uploads`.
  Si quieres mover el path host, define `UPLOADS_HOST_DIR=/var/lib/crm/uploads`
  en `.env.production`.

### Restricciones

- MIME debe ser `application/pdf`.
- Tamaño máximo: 10 MB por archivo.
- Máximo: 50 archivos por cliente.

El nombre con el que se guarda en disco es un UUID nuevo (`storedFilename`),
no el original — evita path traversal y leaks de metadatos. El nombre
original se conserva en BD para mostrar al usuario y para el
`Content-Disposition: attachment; filename="..."` del download.

### Garbage collection

- Borrar un attachment: borra fila BD primero, luego archivo físico
  best-effort (idempotente).
- Borrar un cliente: `CASCADE` borra las filas `client_attachments`,
  y el endpoint DELETE elimina el directorio físico
  `uploads/{slug}/clients/{clientId}/` con `fs.rm({recursive, force})`.
  Si la limpieza física falla, el cliente se borra igual (best effort).
- Pendiente backlog: tarea periódica de GC para detectar directorios
  huérfanos (cliente borrado antes del despliegue de este sprint, o
  fallos transitorios de disco).

### Caveat JWT antiguo

Tras el deploy del sprint Fase 1 (junio 2026), los usuarios actualmente
logueados deben hacer **logout y login** para que el campo `uploadedBy`
se rellene correctamente. Motivo: el middleware empezó a propagar
`X-User-Email` a los handlers en ese deploy, pero el header sale del
JWT (campo `email` del payload), y los JWT emitidos antes del deploy
no se reescriben. Los archivos subidos antes del logout tendrán
`uploadedBy=NULL`.

---

## Notas internas

Sprint Fase 1. Timeline de notas privadas asociadas al cliente, distinto
del modelo `Interaction` legacy.

### Modelo `ClientNote`

```
id          UUID PK
clientId    UUID NOT NULL FK→clients(id) ON DELETE CASCADE
content     TEXT NOT NULL
createdBy   STRING(255)           -- email del admin
createdAt   TIMESTAMPTZ           -- timestamp automático
updatedAt   TIMESTAMPTZ
```

Índices: `client_id`, `created_at DESC`.

### Diferencia con `Interaction`

| Campo | `Interaction` (legacy) | `ClientNote` (nuevo) |
|---|---|---|
| Tipo | `type` ENUM (note/call/email/meeting) | sin tipo — siempre nota |
| Fecha | `date` DATEONLY editable por el usuario | `createdAt` timestamp automático |
| Semántica | Registro de algo ocurrido CON el cliente | Anotación privada del equipo interno |

`Interaction` se mantiene para tenants que ya lo usan (spain_enzymes
tiene historial). En la ficha de paciente de nutri_laura, el bloque
legacy aparece collapsible al final (solo si existe contenido).

### Caveat JWT antiguo

Mismo caveat que en attachments: tras el deploy del sprint Fase 1, los
usuarios deben hacer **logout y login** para que `createdBy` se rellene.
Notas creadas antes del logout tendrán `createdBy=NULL`.

---

## UI

### Profesional de referencia en la ficha (10/08/2026)

`components/clients/ClientProfesionalSection.jsx` — tarjeta compartida, justo
debajo de «Consulta externa», en la ficha default **y** en la de nutri_laura.
Enseña quién lleva el seguimiento y lo cambia en un desplegable
(`PUT /api/clients/:id` con `assignedTeamMemberId`).

Antes el campo solo se podía poner UNA vez y en un sitio: al aceptar la
solicitud en la bandeja (`lib/formularios/accept.js`). No había forma de verlo
ni de corregirlo desde la ficha.

- **No se pinta** sin módulo `team` o sin nadie dado de alta: un desplegable
  vacío no decide nada. Una consulta de una sola profesional sigue sin asignar
  a nadie, como siempre.
- **Quién puede cambiarlo**: quien pueda abrir la ficha, salvo en una consulta
  externa, donde **solo admin** — ahí elegir profesional es elegir quién ve a
  esa persona, y el endpoint lo comprueba (403), no solo la pantalla.
- El endpoint valida que el UUID exista en `team_members` del tenant (422 si
  no) y solo toca el campo si viene explícito en el body, para que un guardado
  de otra sección no deje a nadie sin profesional.
- Avisa si la elegida **no tiene horario propio**: su paciente no vería ni un
  hueco al pedir cita. Mismo aviso que la bandeja de solicitudes.

### Default (vanilla)

`modules/default/ClientDetailModule.jsx` — header (back link + nombre + status
chip + aviso de lista de espera) y, debajo, **seis pestañas** desde el
12/08/2026 (Rodrigo: «demasiado larga, pero universal, para que el que tenga
todos los módulos no se líe»). Antes eran CATORCE tarjetas apiladas en una
columna: en Aumenta la ficha medía varias pantallas y para llegar a la
facturación había que pasar por delante del contrato, los tutores, los
consentimientos y las citas.

| Pestaña | Qué lleva | La pregunta que responde |
| --- | --- | --- |
| **Datos** | Datos del cliente (vista/edición) · Contactos · Datos fiscales · Acceso a la web | quién es y cómo se le escribe |
| **Interacciones** | Historial de interacciones | qué se ha hablado con esta persona |
| **Servicio** | Módulos asignados · Pacientes · Consulta externa · Profesional de referencia | qué se le presta y quién se lo presta |
| **Contrato y avisos** | Tutores · Contrato · Comunicaciones · Meses del portal | qué ha firmado y qué ha consentido |
| **Citas** | Sus citas | su agenda |
| **Facturación** | Resumen y facturas | su dinero |

El patrón (pestañas + `TabButton`) es el que ya usaba nutri_laura; aquí no se
inventó nada, se generalizó.

⚠️ **Una pestaña vacía confunde más que una ficha larga.** Casi todas estas
secciones se esconden solas (`return null`) cuando el tenant no tiene su
módulo, así que un cliente de solo Citas tendría cuatro pestañas que no
enseñan nada. El padre no puede saberlo sin volver a preguntar a los mismos
endpoints, así que **cada panel se mide en el DOM**: sin ningún hijo, su
pestaña desaparece del menú (`PanelPestana`). Todos los paneles se MONTAN
aunque solo se vea uno (`hidden`, no desmonta) — exactamente lo que hacía la
ficha antes de tener pestañas, así que no hay peticiones de más ni se pierde
lo que estés escribiendo al cambiar de pestaña.

#### «Acceso a la web»: crear la cuenta desde la ficha (universal desde 12/08/2026)

`components/clients/ClientCuentaWebSection.jsx`. El botón existía desde el
05/08 pero vivía DENTRO del override de nutri_laura, así que el resto de
clientes —Aumenta incluida, que usa la ficha por defecto— no tenía forma de
abrirle la cuenta a nadie desde el CRM. El backend siempre fue común
(`/api/clients/[id]/portal-user` + `lib/formularios/portalUser.js`); faltaba
el botón. Ahora es una tarjeta compartida por las dos fichas.

Se esconde sola cuando no pinta nada: si quien mira no es admin (403 del
endpoint) o si el centro no tiene web configurada (`motivo: "sin_url"`). Lo
que NO la esconde es que la web no conteste — «no he podido preguntar» es
distinto de «no tiene cuenta» y se dice tal cual.

### Override nutri_laura

`modules/overrides/nutri-laura/ClientDetailModule.jsx` — ficha de paciente
con **5 tabs** (rediseño Checkpoint 3, junio 2026; nombres revisados el
04/08/2026 por Rodrigo). Los rótulos son lo ÚNICO que cambió en esa revisión:
claves, paneles, tablas y endpoints siguen siendo los de siempre —
`attachments` sigue leyendo adjuntos y `bookings`, citas—.

| Tab | Componente | Endpoints leídos | Notas |
|---|---|---|---|
| Datos (antes "Información") | `PatientCard` + delete inline | `GET/PUT/DELETE /api/clients/:id` | Edición inline; `editMode`/`editForm` viven en el padre para sobrevivir cambios de tab |
| Historia clínica (antes "Notas") | `ClientNotesPanel.jsx` | `GET/POST /api/clients/:id/notes`, `DELETE /api/clients/:id/notes/:noteId` | Paginación incremental "Cargar más" (limit 50). Sin restricción de borrado por autor (Laura es única usuaria) |
| Documentos (antes "Adjuntos") | `ClientAttachmentsPanel.jsx` | `GET/POST /api/clients/:id/attachments`, `DELETE`, `GET .../download` | Drop zone + validación frontend (PDF, ≤10MB, ≤50 archivos) |
| Sesiones (antes "Citas") | `ClientBookingsPanel.jsx` | `GET /api/citas/bookings?clientId=&clientEmail=`, `PATCH .../confirm`, `PATCH .../reject` | En la consulta cada cita ES una sesión de seguimiento. Confirm/Reject inline para `pending` con mini-modal opcional para motivo |
| Pautas (antes "Plan") | `ClientPlansPanel.jsx` | `GET /api/clients/:id/plans`, `POST /api/nutricion/plans/:id/reapply-template` | Plan activo + histórico archivado (Recetario C4) |

**Permisos**: el detalle hace gate por `me.role ∈ {admin, superadmin, employee}`
fetcheando `/api/auth/me` al montar. Sin rol válido → "Sin acceso".

**Header**: back link a `/clientes`, nombre, status chip (Paciente activo, En
seguimiento…), edad/email/teléfono inline, link "↳ Lead origen" si
`client.leadId` (o `customFields.leadId` por compat).

**`InteractionsLegacySection`**: archivado en
`modules/overrides/nutri-laura/_InteractionsLegacySection.jsx` (con prefijo
`_` para indicar no-importado). La tabla `interactions` no existe en
`crm_nutri_laura`, así que la sección desapareció del tab Información. Si
en el futuro se decide crearla, restaurar el import. El backend
`GET /api/clients/:id` tolera la tabla missing con try/catch del 42P01 —
otros tenants donde la tabla SÍ existe siguen recibiendo el array poblado
para el default module.

**Componente reusable**: `components/ui/TimestampRelative.jsx` — render
"hace 5 min" con tooltip absoluto en zona Madrid; usado por los paneles
Notas y Adjuntos.

El wrapper `app/(dashboard)/clientes/[id]/page.jsx` selecciona override
por `x-tenant` del header (puesto por middleware desde el JWT). Tenants
sin entrada en `UI_OVERRIDES` ven el módulo default.

### Backlog UI (post-Checkpoint 3)

- PATCH endpoint `/api/clients/:id/notes/:noteId` para edición inline de
  notas (hoy solo crear/borrar).
- Enforce ownership backend en `DELETE` de notes y attachments cuando
  entre una segunda usuaria al tenant.
- Drawer detalle de Booking en la tab Citas (click en fila).
- Botón "Marcar completada" para bookings `confirmed`.
- FK física `Booking.clientId → clients.id` opcional, evitando que un
  cambio de email del cliente deje bookings huérfanos en su ficha.
- Distinguir "Rechazada" vs "Cancelada" desde un campo real (hoy se
  heurística por presencia de `cancellationReason`).
- Override del listado `/clientes` para nutri_laura (icono ojo en lugar
  de texto "Ver ficha →").

---

## Asignación de clientes a módulos (Nutrición / Clínica)

Sprint "Clientes ↔ módulos" (2026-07-15). Desde la ficha del cliente se puede
marcar como **Paciente Nutrición** y/o **Paciente Clínica** (sección "Módulos
asignados", componente `components/clients/ClientModulesSection.jsx`, incluido
en la ficha default y en el override de nutri-laura).

**Modelo de datos** (Opción B — tabla, no booleans): `client_module_assignments`
(`ClientModuleAssignment.model.js`) — `client_id` (FK→clients CASCADE),
`module_key`, `enabled`, `assigned_at`, `assigned_by_user_id`, `metadata` JSONB,
`UNIQUE(client_id, module_key)`. Extensible a N módulos + metadata por asignación
(p.ej. nutricionista). Se eligió tabla sobre booleans por extensibilidad,
histórico y metadata.

**Endpoints**:
- `GET /api/clients/:id/module-assignments` → `{ available, assignments }`
  (`available` = módulos asignables que el tenant tiene activos).
- `PATCH /api/clients/:id/module-assignments` — body `{ assignments: [{ module_key, enabled }] }`.
  Upsert transaccional por `(client_id, module_key)` + AuditLog.
- `GET /api/clients?assignedTo=nutricion` — filtra por asignación activa
  (include `required` + `distinct`, guard 42P01 → lista vacía en schema parcial).

**Asimetría Nutrición vs Clínica** (clave):
- **Nutrición** es client-céntrica: `plans.client_id` ya enlaza planes a clientes.
  La asignación es *pertenencia/intención*; la vista `/nutricion/asignados`
  sigue siendo **plan-céntrica** (lista planes asignados), sin refactor — eso es
  un sprint posterior. Marcar "Paciente Nutrición" NO lo hace aparecer aún en
  `/asignados` (solo lo hace tener un plan asignado); el flag deja el dato listo.
- **Clínica** lee la tabla `patients`, independiente de `clients`. Al marcar
  "Paciente Clínica" se **materializa** un `Patient` enlazado por el nuevo
  `patients.client_id` (nullable, FK SET NULL) copiando el nombre; al desmarcar
  se **borra** ese Patient **solo si no tiene** sesiones/informes (FK RESTRICT),
  si los tiene se conserva. Lógica en `lib/clients/moduleAssignments.js`
  (`syncClinicPatient`). Índice único parcial `patients_client_unique` = un
  Client materializa como mucho un Patient.

**Auto-marcado en el alta (2026-07-27, decisión de nutri_laura, reina de
nutrición)**: en tenants con el módulo `nutricion` activo, TODA alta de cliente
marca sola la asignación `nutricion` (`AUTO_ASSIGN_MODULE_KEYS` +
`applyAutoAssignments` en `lib/clients/moduleAssignments.js`). Cubre los tres
caminos de alta: POST `/api/clients` (manual y conversión de lead),
aceptar solicitud de Formularios e importación masiva. Siempre FUERA de la
transacción del alta y best-effort (`findOrCreate` sobre el único, tolera tabla
sin migrar): un fallo del extra no tumba el alta. Decide con `tenantHasModule`
(módulo del tenant), no `hasModule` (que exige además el moduleAccess del
usuario que crea la ficha). `clinica` queda EXPRESAMENTE fuera: Aumenta pidió
paciente siempre explícito. Metadata `{auto: true}` distingue el marcado
automático del manual.

**Backfill** (`scripts/migrate-client-module-assignments.js`, solo `nutri_laura`):
marca `nutricion` a los clients con plan asignado activo **o** `origin='lead'`.
Idempotente; no toca los dados de alta a mano.
`scripts/backfill-nutricion-assignments.js` (ONE_OFF, 2026-07-27) completa el
resto: marca `nutricion` a TODOS los clientes no inactivos de los tenants con el
módulo, para alinear a los creados antes del auto-marcado. Repetible
(`ON CONFLICT DO NOTHING`; respeta un `enabled=false` puesto a mano).

**⚠️ Orden de deploy**: el nuevo atributo `Patient.clientId` hace que toda lectura
de Patient seleccione `patients.client_id`; correr la migración **ANTES** de
desplegar (es forward-compatible: solo añade tabla/columna que el código viejo
ignora). En el VPS: `git pull` → `docker exec ... node scripts/migrate-client-module-assignments.js` → `./deploy.sh`.

### Backlog (sprint siguiente)
- Refactor de `/nutricion/asignados` a paciente-céntrico (leer también clientes
  con asignación `nutricion` sin plan aún) — es el motivo por el que este sprint
  prepara el terreno.
- UI de metadata por asignación (p.ej. nutricionista asignado en `metadata`).
- Checkbox de módulos también en el panel de edición rápida del listado `/clientes`.
- Reconciliación de la doble fuente de verdad Nutrición (flag vs `plans.client_id`).
