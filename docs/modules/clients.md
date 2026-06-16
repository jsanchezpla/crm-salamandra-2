# Módulo Clientes

## Resumen

Módulo genérico para gestionar clientes (o "pacientes", según el tenant)
del CRM. Cada tenant con `moduleKey="clients"` activado en
`master.tenant_modules` tiene su tabla `crm_{slug}.clients` y endpoints
bajo `/api/clients/*`.

Tenants que lo usan hoy: `spain_enzymes` (B2B), `nutri_laura` (B2C,
"pacientes"), `demo`, `retorika` (cuentas mínimas para asociar con
training).

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

### Default (vanilla)

`modules/default/ClientDetailModule.jsx` — ficha clásica con: header
(back link + nombre + status chip), datos del cliente (vista/edición),
historial de interacciones, sección de facturación.

### Override nutri_laura

`modules/overrides/nutri-laura/ClientsModule.jsx` — ficha de paciente
reordenada:

1. Header con back link, nombre, status chip, edad + email + teléfono inline.
2. Columna izquierda: datos del paciente (motivo de consulta + info adicional
   resaltados; status con etiqueta "Paciente activo"); botón eliminar discreto.
3. Columna derecha: Próximas citas (fetch `/api/citas/bookings?clientEmail=&future=true`),
   Documentos PDF (drop zone + lista), Notas internas timeline, Interacciones
   legacy collapsible al final si existen.

El wrapper `app/(dashboard)/clientes/[id]/page.jsx` selecciona override
por `x-tenant` del header (puesto por middleware desde el JWT). Tenants
sin entrada en `UI_OVERRIDES` ven el módulo default.
