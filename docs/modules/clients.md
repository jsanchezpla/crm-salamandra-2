# Módulo Clientes

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `clients` · requiere — (`lib/provisioning/dependencias.js`: funciona solo) · `clients_avanzado` requiere `clients`: la lista de espera de admisión y «Fichas a completar» |
| **Reina** | — · sin reina declarada; lo más parecido es `lib/clients/piezasFicha.js`: «Aumenta no cambia» (Jorge, 18/08/2026), la ficha base tiene la forma de Aumenta |
| **Pantallas** | `/clientes` → `app/(dashboard)/clientes/page.jsx` (+ `ClientesClient.jsx`: listado y alta; resuelve perfil y rótulo en servidor) · `/clientes/[id]` → `app/(dashboard)/clientes/[id]/page.jsx` (elige la ficha por `UI_OVERRIDES` y resuelve perfil, piezas y textos en servidor) · `clients_avanzado`: `/clientes/lista-espera` → `app/(dashboard)/clientes/lista-espera/page.jsx` (+ `ListaEsperaClient.jsx`) y `/clientes/urgentes` → `app/(dashboard)/clientes/urgentes/page.jsx` (+ `FichasACompletarClient.jsx`), las dos con `notFound()` sin el módulo |
| **Endpoints** | `app/api/clients/**` — 26 `route.js`: `route.js` (listado/alta), `export`, `import`, `[id]` y debajo `notes` (+ `[noteId]`), `attachments` (+ `[attachmentId]`, `download`), `interactions`, `contact-methods` (+ `[methodId]`), `guardians`, `contract` (+ `download`, `firmado/[documentoId]`), `comunicaciones`, `portal-months`, `portal-user`, `module-assignments`, `plans` (Pautas), `projects` (gatea `projects`), `billing-summary` (gatea `billing`); `clients_avanzado`: `waitlist` (+ `[id]`) y `urgentes` · Públicos: ninguno propio (el portal de la familia, `app/api/public/c/[tenantSlug]/citas-portal/**`, es de Citas y escribe `communication_prefs` y las firmas del contrato) |
| **Lógica** | `lib/clients/` (20 ficheros): `formularioAlta.js` (qué se pregunta en el alta, perfil salud/comercial) · `camposFiscales.js` (los campos de «Datos de facturación», declarados una vez y compartidos por la tarjeta de la ficha y el panel «Editar ficha» del listado — 31/08/2026) · `familiasPorPaciente.js` (los ids de familia que salen al buscar por el nombre del paciente; lo usan facturas y presupuestos — 31/08/2026) · `estados.js` (Activo/No vino/Baja, la columna `clients.status`; solo perfil salud) · `vocabulario.js` (Clientes/Pacientes) · `piezasFicha.js` (qué paneles monta la ficha) · `moduleAssignments.js` (Paciente Nutrición/Clínica, auto-marcado) · `clientContract.js` + `guardians.js` + `contratoFirma.js` + `datosFicha.js` (contrato del centro, tutores, datos y firma) · `comunicaciones.js` (permiso de aviso por canal) · `contactMethods.js` (emails/teléfonos múltiples con principal) · `consultaExterna.js` (quién ve a los pacientes de empresas) · `listaEspera.js` + `urgentes.js` (`clients_avanzado`) · `attachmentStorage.js` + `signatureStorage.js` (disco) · `avisoBorrado.js` + `borrarRastro.js` (borrar una ficha) |
| **UI** | `modules/default/ClientDetailModule.jsx` (ficha base: pestañas que se esconden vacías, `PanelPestana`) · `components/clients/`: paneles compartidos `ClientNotesPanel.jsx`, `ClientAttachmentsPanel.jsx`, `ClientBookingsPanel.jsx`; secciones `ClientContractSection.jsx`, `ClientGuardiansSection.jsx`, `ClientComunicacionesSection.jsx`, `ClientContactMethodsSection.jsx`, `ClientModulesSection.jsx`, `ClientProfesionalSection.jsx`, `ClientCuentaWebSection.jsx`, `ClientConsultaExternaSection.jsx`, `ClientPortalMonthsSection.jsx`, `ClientFiscalSection.jsx`, `ClientPatientsSection.jsx`, `ClientCitasSection.jsx`, `ClientBonosSection.jsx`; alta: `PacientesDelAlta.jsx`, `ProgenitoresDelAlta.jsx`, `FacturacionDelAlta.jsx` · Pautas: `modules/nutricion/ClientPlansPanel.jsx` |
| **Modelos** | `Client` (`clients`), `Contact` (`contacts`), `Interaction` (`interactions`, legacy), `ClientNote` (`client_notes`), `ClientAttachment` (`client_attachments`), `ClientContactMethod` (`client_contact_methods`), `ClientModuleAssignment` (`client_module_assignments`), `ContractSignature` (`contract_signatures`); `clients_avanzado`: `WaitlistEntry` (`waitlist_entries`), `DataReview` (`data_reviews`) |
| **Interruptores y parámetros** | `featureFlags` propios: ninguno; `lib/clients/moduleAssignments.js` lee `nutricion.autoAsignarEnAlta` (auto-marcado en el alta, apagado por defecto). `logicOverrides`: nadie los lee. `schemaExtensions` de `clients` en nutri_laura (edad, motivo, info_adicional): letrero decorativo, el código no lo lee. Reglas por MÓDULOS (peldaño 2): `piezasFicha.js` (Notas si no `clinica`; Documentos si no `documents_avanzado`; Citas si `citas` y no `clinica`), `vocabulario.js` (Pacientes si `nutricion` y no `pacientes`/`clinica`), `formularioAlta.js` (perfil `salud` con `pacientes`/`clinica`/`nutricion`), `estados.js` (los tres estados de la ficha, solo en perfil salud), `avisoBorrado.js` (la frase de borrado). Rótulo por slug: `TENANT_TITLE_OVERRIDES` en `app/(dashboard)/clientes/[id]/page.jsx` (nutri_laura → «Paciente») |
| **Pantallas propias** | `modules/overrides/nutri-laura/ClientDetailModule.jsx` (cabecera + tarjeta + 5 pestañas; los paneles vienen de `components/clients/`), cargado por `UI_OVERRIDES` de `app/(dashboard)/clientes/[id]/page.jsx`. Es la única: el letrero `ui_override` en producción dice `nutri-laura/ClientDetailModule` y lo mantiene `scripts/sincronizar-ui-override.mjs` |
| **Scripts** | activar: `node scripts/enable-module.js <slug> clients` (y `clients_avanzado`); arrastra `MODULES.clients` de `scripts/_module-migrations.js` (12: `migrate-client-attachments-and-notes`, `migrate-client-module-assignments`, `migrate-client-communication-prefs`, `migrate-client-birthdate`, `migrate-consultas-externas`, `migrate-nutricionista-asignada`, `migrate-data-reviews`, `migrate-interactions-notes-team`, `migrate-patients-clients-phase1` y las tres `migrate-documents-*`) más las CORE que tocan `clients` (`migrate-sprint-aumenta-2026-07`, `migrate-waitlist-therapist`, `migrate-client-fiscal-taxid`, `migrate-citas-autoconfirmadas-por-paciente`) · `migrate-clients-avanzado.js` (master, una vez, ya corrido) · ONE_OFF ya ejecutados: `migrate-contract-patient-to-client.js`, `migrate-auto-asignar-nutricion.js`, `backfill-nutricion-assignments.js`, `backfill-patients-client.js` · herramientas vivas: `borrar-rastro-paciente.js`, `comprobar-admision.js` (solo lectura), `_hechos/fusionar-tutores-aumenta.js` y `corregir-emails-importados.js` (importación de Aumenta; simulan sin `--confirm`) · `npm run db:check-links` y `npm run db:check-access` (`package.json`) |
| **Pruebas** | en `npm test`: `scripts/_smoke-clients-contactos.mjs` (`node:test`, 19/08/2026: `contactMethods.js`, el espejo del correo/teléfono principal con un `ClientContactMethod` de mentira), `_smoke-clients-lista-espera.mjs` (`node:test`: `listaEspera.js` con modelos de mentira), `scripts/_smoke-clients-comunicaciones.mjs` (`node:test`, 19/08/2026: las cuatro decisiones de `lib/clients/comunicaciones.js` y `citaPuedeAvisar` con un `Client` de mentira), `_smoke-piezas-ficha.mjs` (`// @prueba ligera`; la forma de Aumenta), `_smoke-consultas-externas.mjs` (`// @prueba ligera`), `_smoke-alta-progenitores.mjs` (`formularioAlta` + `clientContract`), `_smoke-datos-edad.mjs`, `_smoke-datos-antes-de-firmar.mjs` y `_smoke-menor-firma.mjs` (`datosFicha` + `contratoFirma`, con `check()`), `scripts/_smoke-clients-contrato-firma.mjs` (`node:test`, 19/08/2026: lo que devuelve `lib/clients/contratoFirma.js` —`letraDocumentoCorrecta` solo juzga la letra de lo que parece DNI o NIE, un pasaporte pasa; `edadEn`/`esMenor` cuentan años cumplidos en UTC, con el día del cumpleaños y el 29 de febrero, y «no lo sé» cuenta como mayor a propósito, y desde el 21/08/2026 una fecha de nacimiento **FUTURA** también cuenta como «no lo sé»: `edadEn` acota el resultado a 0..120 —el mismo tope que `edadDesde` de `formularioAlta.js`— en vez de devolver años en negativo, que `esMenor` leía como «menor de 18» y le pedía a una adulta el consentimiento de su tutor; y `validarDatos` la rechaza ya en la puerta con «"Fecha de nacimiento" no puede ser una fecha futura», reconociendo el campo por su destino (`cliente.birthDate`, `tutor.birthDate`) o por su clave (`fechaNacimiento`/`birthDate`/`fnac`) —la fecha de la FIRMA queda fuera a propósito: un desfase de reloj entre navegador y servidor dejaría a alguien sin poder firmar, y una fecha futura que YA estuviera guardada en la ficha tampoco bloquea la firma, porque quien firma ni la puso ni puede quitarla—; `camposDe`/`bloquesDe`/`serializarPlantilla` normalizan la plantilla JSONB y la mandan al portal ya resuelta contra la ficha; `validarDatos` dice qué entra y con qué frase se rechaza, tira lo que la plantilla no declara, y el DNI deja de ser obligatorio por edad con la fecha de nacimiento que SE ESTÁ ESCRIBIENDO antes que con la guardada; desde el 19/08 una fecha que no existe —31 de febrero, 31 de abril, 29/02 en año no bisiesto— se rechaza como «no es una fecha real» en vez de llegar a la ficha y tumbar Postgres; `documentosQueAplican`/`situacionDocumentos`: el consentimiento parental solo sale para menores y el contrato no está completo hasta que TODOS los firmantes han firmado TODO lo que les aplica; `validarAceptaciones`: cada anexo se acepta por separado con id, título y hora—), `scripts/_smoke-clients-module-assignments.mjs` (`node:test`, 20/08/2026: `lib/clients/moduleAssignments.js` con modelos falsos —qué casillas de módulo se pintan en la ficha; el auto-marcado de «Paciente Nutrición» en el alta lo decide el flag `nutricion.autoAsignarEnAlta`, no tener el módulo: con el flag apagado, o sin función de flags siquiera, NO se marca nada y ni se toca la tabla; `clinica` no se auto-asigna JAMÁS (quien paga no siempre asiste); `profesional_salud` es una marca gateada por `citas`, no un módulo: la pone el lead leído en el servidor —no el navegador— y es la que abre los tipos de cita de profesionales; y una tabla sin migrar (42P01) nunca tumba un alta ni una conversión—), `_smoke-clientes-estados.mjs` (`node:test`, 26/08/2026: los tres estados de `lib/clients/estados.js` —que son los del ENUM y no más, que un valor de fuera se rechaza antes de llegar al `where`, que «No vino» y «Baja» dejan de reclamar datos y un estado desconocido NO (ante la duda se enseña), y que un cliente comercial no lo usa: allí `prospect` ya significa «compró una vez»—), `_smoke-borrar-paciente.mjs` (`borrarRastro`), `_smoke-ui-overrides.mjs` (cuenta la ficha de Laura) — las sin marca las clasifica el runner por texto · con base de datos: `_smoke-contrato-estructurado.mjs`, `_smoke-lead-conversion-fix.js` |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-08-01-alta-de-clientes-por-perfil.md` · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` · `../decisions/2026-08-04-fichas-a-completar-cuelga-de-clients-avanzado.md` · `../decisions/2026-08-18-la-piramide-invertida-de-leads.md` |
| **En este doc** | Modelo `Client` · Endpoints · «No vino»: el estado de una ficha (26/08/2026) · Contrato del Centro (sprint Aumenta 2026-07, punto 1.1) · Comunicaciones: por dónde se le escribe a cada familia (01/08/2026) · Archivos adjuntos · UI · Asignación de clientes a módulos (Nutrición / Clínica) |

## Resumen

Módulo genérico para gestionar clientes (o "pacientes", según el tenant)
del CRM. Cada tenant con `moduleKey="clients"` activado en
`master.tenant_modules` tiene su tabla `crm_{slug}.clients` y endpoints
bajo `/api/clients/*`.

Lo tienen **los once tenants** de producción (foto de `master` del
19/08/2026): es el módulo que está debajo de casi todo lo demás. Quién lo
usa de verdad se ve en el número de fichas —Aumenta con 1.083, Laura con
16—, no en esta lista; para la foto del día, `/admin/modulos` o
`node scripts/inspect-tenant-modules.js <slug>`.

> **Histórico (hasta 08/2026):** este párrafo decía «`spain_enzymes` (B2B),
> `nutri_laura` (B2C, "pacientes"), `demo`, `retorika`», que era la foto de
> junio. El módulo se da de fábrica en el alta de cliente desde entonces.

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
| `/api/clients` | GET | Listado paginado (filtros: search, country, `status` = embudo comercial en `customFields`, `estado` = estado de la ficha en la COLUMNA —`active`/`prospect`/`inactive`—; un `estado` desconocido se ignora) | JWT + `hasModule(clients)` |
| `/api/clients` | POST | Crear cliente (acepta `customFields` libre + leadId/origin/seStatus) | JWT |
| `/api/clients/[id]` | GET | Detalle + interactions | JWT |
| `/api/clients/[id]` | PUT | Editar (merge `customFields`). ⚠️ Tres llaves parecidas y distintas: `status` es el embudo comercial (`customFields.seStatus`), `estado` es el estado de la ficha (la columna, 422 si no es uno de los tres) y `archivada` sigue valiendo como el interruptor de siempre —manda `estado` si vienen los dos | JWT |
| `/api/clients/[id]` | DELETE | Borrar. Bloquea si tiene facturas. **GC** del directorio físico de attachments | JWT |
| `/api/clients/[id]/interactions` | GET/POST | Timeline legacy de interacciones (call/email/meeting/note) | JWT |
| `/api/clients/[id]/notes` | GET/POST | Notas internas (ver sección abajo) | JWT |
| `/api/clients/[id]/notes/[noteId]` | DELETE | Borrar nota | JWT |
| `/api/clients/[id]/attachments` | GET/POST | Archivos PDF (ver sección abajo) | JWT |
| `/api/clients/[id]/attachments/[attachmentId]` | PATCH | `{ visibleToClient }`: si el paciente lo ve en su portal (solo adjuntos `source='ficha'`) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/attachments/[attachmentId]` | DELETE | Borrar attachment (BD + disco) | JWT |
| `/api/clients/[id]/attachments/[attachmentId]/download` | GET | Stream del PDF | JWT |
| `/api/clients/[id]/contact-methods` | GET/POST | Emails y teléfonos múltiples con uno principal (`lib/clients/contactMethods.js`) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contact-methods/[methodId]` | PATCH/DELETE | Editar / borrar un medio de contacto | JWT + `hasModule(clients)` |
| `/api/clients/[id]/guardians` | GET/PUT | Padres/tutores de la familia + estado de firma | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contract` | GET/POST/DELETE | Contrato del Centro de la familia (PDF) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contract/download` | GET | Stream del PDF del contrato | JWT + `hasModule(clients)` |
| `/api/clients/[id]/contract/firmado/[documentoId]` | GET | La COPIA FIRMADA (`documents` con `source='contrato_firmado'` de ESTA ficha); `?ver=1` la abre inline. Cuelga de `clients` y no de `documents_avanzado` a propósito (06/08/2026) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/comunicaciones` | GET/PUT | Permiso de aviso por canal (`communication_prefs`; ver sección abajo) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/portal-months` | GET/PUT | Meses abiertos del área privada (bloqueo por impago) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/portal-user` | GET/POST | ¿Tiene cuenta en la web? / crearle la cuenta en WordPress (`lib/formularios/portalUser.js`, ver «Acceso a la web») | JWT + **solo admin** |
| `/api/clients/[id]/module-assignments` | GET/PATCH | Marcar «Paciente Nutrición» / «Paciente Clínica» (ver sección abajo) | JWT + `hasModule(clients)` |
| `/api/clients/[id]/plans` | GET | Pautas (menús) de la ficha: activas + archivadas | JWT + `hasModule(nutricion)` |
| `/api/clients/[id]/projects` | GET | Proyectos del cliente | JWT + `hasModule(projects)` |
| `/api/clients/[id]/billing-summary` | GET | Resumen facturas | JWT + `hasModule(billing)` |
| `/api/clients/waitlist` | GET/POST/PATCH | Lista de espera de ADMISIÓN (`lib/clients/listaEspera.js`; no es la de Citas) | JWT + `hasModule(clients_avanzado)` |
| `/api/clients/waitlist/[id]` | PATCH | Editar una entrada de la cola, sacarla (`status: "removed"`) o convertirla en cliente (`convertir: true`; la entrada queda `converted` con su `clientId`). **Dar plaza propaga el terapeuta asignado en la cola** (31/08/2026, `propagarTerapeutaAlAceptar` en `lib/clients/listaEspera.js`, prueba `_smoke-lista-espera-propaga.mjs`): a los pacientes de la familia sin terapeuta (vía `sincronizarTerapeutas`) y al `assignedTeamMemberId` de la ficha si estaba vacío; `convertir: true` crea la ficha nueva ya con él | JWT + `hasModule(clients_avanzado)` |
| `/api/clients/urgentes` | GET/POST | «Fichas a completar» por carpetas (`lib/clients/urgentes.js`; `?soloTotales=1` para el menú, `?incluirBajas=1` para ver también las fichas archivadas) / marcar revisado (`data_reviews`) | JWT + `hasModule(clients_avanzado)` |
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
chip + aviso de lista de espera) y, debajo, **pestañas** desde el
12/08/2026 (Rodrigo: «demasiado larga, pero universal, para que el que tenga
todos los módulos no se líe»): nacieron seis y `pestanasDe()` define hoy
**diez** (se sumaron Notas/Historia clínica, Documentos, Pautas y WhatsApp), de
las que cada tenant ve solo las que no le quedan vacías. Antes eran CATORCE
tarjetas apiladas en una columna: en Aumenta la ficha medía varias pantallas y
para llegar a la facturación había que pasar por delante del contrato, los
tutores, los consentimientos y las citas.

| Pestaña | Qué lleva | La pregunta que responde |
| --- | --- | --- |
| **Datos** | Datos del cliente (vista/edición) · Contactos · Datos fiscales · Acceso a la web | quién es y cómo se le escribe |
| **Interacciones** | Historial de interacciones | qué se ha hablado con esta persona |
| **WhatsApp** | El hilo de WhatsApp, de lectura | qué se le ha dicho por WhatsApp y si llegó |
| **Notas** / **Historia clínica** ⁽¹⁾ | Entradas de texto con autor y fecha (`client_notes`) | el diario de esta persona |
| **Servicio** | Módulos asignados · Pacientes · Consulta externa · Profesional de referencia | qué se le presta y quién se lo presta |
| **Contrato y avisos** | Tutores · Contrato · Comunicaciones · Meses del portal | qué ha firmado y qué ha consentido |
| **Documentos** ⁽¹⁾ | Sus ficheros (`client_attachments`), «que lo vea en su portal», firmas documento a documento | sus papeles |
| **Citas** | Interruptor de autoconfirmar · Bonos · y, ⁽¹⁾, la lista de sus citas con Confirmar/Rechazar | su agenda |
| **Pautas** | El menú que sigue (solo con `nutricion`) | qué come |
| **Facturación** | Resumen y facturas | su dinero |

⁽¹⁾ **Las tres piezas que vinieron de la ficha de Laura (18/08/2026).**
Vivían en `modules/overrides/nutri-laura/` sobre tablas y endpoints que tiene
TODO el mundo (`client_notes`, `client_attachments`, `bookings`; gateados solo
por `clients` y `citas`). Pasaron a `components/clients/` (`ClientNotesPanel`,
`ClientAttachmentsPanel`, `ClientBookingsPanel`) y las monta esta ficha **para
quien diga `lib/clients/piezasFicha.js`**, por módulos y con la condición
negativa como en `vocabulario.js`:

| Pieza | Se monta si | Por qué la negativa |
| --- | --- | --- |
| Notas / Historia clínica | `clients` y **no** `clinica` | en un centro clínico la historia clínica son las sesiones e informes del módulo `clinica`, no notas en la ficha de la familia |
| Documentos | `clients` y **no** `documents_avanzado` | el archivo avanzado ya cuelga cada fichero de su ficha (`documents.client_id`) |
| Lista de citas | `citas` y **no** `clinica` | un centro clínico ya llama «Sesiones» a `clinic_sessions`; y **Aumenta no cambia** (decisión de Jorge, 18/08/2026) |

Con eso, en producción: aumenta, somos y `demo` **no ven ninguna** (misma
forma que hoy); `demo_nutricion` ve las tres y las llama Historia clínica /
Documentos / Sesiones del paciente (vocabulario de paciente); `demo_agencia`,
`gm_alvar_alonso`, `retorika`, `spain_enzymes` y `salamandra_solutions` ven
Notas y Documentos; `demo_clinica` solo Documentos. Lo vigila
`scripts/_smoke-piezas-ficha.mjs` (`npm test`), que tiene escrita la forma de
Aumenta y falla si gana una pestaña. Los textos («el cliente» / «el paciente»)
salen de `textosPiezas(vocab)` y llegan a los paneles por la prop `textos`; la
página lo resuelve todo de una vez con `fichaSegunModulos(tieneModulo)`.

**WhatsApp** (`ClientWhatsappSection`, endpoint `GET /api/clients/[id]/whatsapp`)
lee `whatsapp_messages` — la Cloud API no guarda conversaciones, así que lo que
no esté en esa tabla no está en ningún sitio. Enseña quién dijo qué, marca con
un sello «CRM» lo que mandó el sistema (frente a lo que escribió la profesional
desde su móvil), y el acuse de entrega de cada aviso con su motivo cuando falla
— eso último es lo que hay que poder enseñar cuando alguien pregunta por qué no
le llegó el recordatorio.

**Es de solo lectura a propósito.** Con la coexistencia el número sigue vivo en
el móvil de la profesional: ahí contesta ella, gratis y sin ventana de 24 h. Una
caja de respuesta aquí funcionaría solo si el paciente hubiera escrito hace
menos de un día y fallaría el resto del tiempo, que es justo cuando alguien
confiaría en ella.

⚠️ La ficha de nutri_laura (`modules/overrides/nutri-laura/`) pinta sus pestañas
a mano y no usa `PanelPestana`, así que allí la sección avisa por `onEstado` y
la pestaña se filtra con `hayWhatsapp`. Y el panel va **montado siempre**
(oculto con `hidden`), no `tab === "whatsapp" && …`: si solo se montara al abrir
su pestaña, la pestaña no aparecería nunca — no se puede abrir lo que no está.

## «No vino»: el estado de una ficha, en vez de borrarla (26/08/2026)

Lau (Aumenta) pidió el 14/08 sacar de en medio las fichas de «gente que llamó o
dejó sus datos pero nunca llegó a empezar». La primera lectura fue borrarlas, y
se cayó sola en cuanto se midió: de esas 118 fichas mudas, **21 tienen 127
facturas cobradas** (14.820 €) repartidas en cinco ejercicios y dos series, y
`invoices.client_id` es **ON DELETE CASCADE**. La factura, además, no guarda ni
un dato fiscal propio —nombre, NIF y dirección se leen en vivo de `clients`
(`lib/billing/nifCliente.js`)—, así que borrar la ficha no solo se llevaría las
filas: dejaría un documento legalmente obligatorio que ya no se puede reimprimir.

Lo que hacía falta no era borrar a nadie: era **poder decirlo**. Jorge, el
26/08: «tampoco quiero borrar a la persona, simplemente que tenga el status de
que no ha venido».

### Dónde vive, y por qué no hizo falta ninguna columna

`clients.status` ya era `ENUM('active','inactive','prospect')` y **`prospect`
estaba sin estrenar**: 0 fichas en Aumenta. Es exactamente «no llegó a ser
cliente», así que el estado va ahí. Los rótulos, en `lib/clients/estados.js`:

| En pantalla | Columna | Qué significa |
| --- | --- | --- |
| **Activo** | `active` | Viene, o se cuenta con que venga |
| **No vino** | `prospect` | Llamó o dejó sus datos y nunca llegó a empezar |
| **Baja** | `inactive` | Vino y ya no viene |

⚠️ **No es el mismo campo que el chip que se veía hasta ese día.** Aquel leía el
embudo comercial (`customFields.seStatus`), y el embudo **no lo ha usado nadie
nunca**: medido el 26/08 en los siete tenants con fichas, todo valor no vacío es
el `new` que estampaba el alta o una ficha suelta que alguien tocó una vez. En
Aumenta las 1.083 lo tienen vacío, y el respaldo a `"new"` hacía que una familia
con cuatro años de historia y 127 facturas saliera como **«Nuevo»**.

### Solo en perfil salud, y eso es una decisión

En un cliente comercial la columna **ya significa otra cosa**: la tienda marca
`prospect` a quien ha comprado una vez y todavía no es cartera
(`lib/tienda/pedidoDesdeTienda.js`), y laura_ubeda tiene sus 183 fichas así.
Enseñarles «No vino» sería mentir sobre gente que sí compró. Los comerciales se
quedan con su embudo, intacto. El día que uno lo pida, se le decide el rótulo
—que es el peldaño 1 de la escalera— y se enciende.

### El archivo y el estado son el MISMO campo

Archivar (25/08) ya escribía `inactive` en esa columna. Con un tercer valor, un
interruptor de dos posiciones no llega: al desarchivar volvía siempre a `active`,
así que archivar y desarchivar a alguien marcado «No vino» lo ascendía a Activo
en silencio. Por eso el desplegable **sustituye** al botón donde hay estado (y el
botón se queda donde no lo hay). Un campo, un sitio.

### Qué cambia en las pantallas

- **Ficha**: el chip de la cabecera dice el estado, y un desplegable al lado lo
  cambia de un clic, sin pasar por «Editar». Fuera el botón de archivar.
- **Listado**: las pestañas de filtro y el selector del panel son los tres
  estados; el filtro va al SERVIDOR por `?estado=` (la columna), no por
  `?status=` (que sigue siendo el embudo). Un valor desconocido se ignora, como
  el resto de filtros: `status` es un ENUM y un valor de fuera reventaría la
  consulta.
- **Fichas a completar**: cada fila de una carpeta de FAMILIA lleva un «No vino»
  que la marca sin abrir la ficha —eran 90 las que había que marcar en Aumenta, y
  abrir noventa fichas no lo hace nadie— y la carpeta deja de reclamarle datos,
  igual que ya hacía con las bajas. La casilla de arriba pasa a llamarse
  «Incluir bajas y «No vino»».

### El otro campo que dejó de inventarse

El PUT de la ficha estampaba `seStatus: "new"` en cualquier guardado que no lo
trajera, o sea en TODOS los de un centro clínico. Con el estado nuevo eso iban a
ser 90 guardados seguidos escribiendo un embudo comercial en un cliente que no lo
enseña. Ya no: quien lo usa lo manda, y entonces se guarda. Es el mismo arreglo
que se le hizo a `origin` el 08/08/2026 y por el mismo motivo.

## «Fichas a completar» no reclama datos de fichas archivadas (25/08/2026)

Lo pidió Lau (Aumenta) el 14/08: la pantalla le sacaba una y otra vez gente que
ella ya había dado de baja. Medido en producción el 25/08, tenía razón y de
sobra: de las **171 filas del bloque rojo** —el que tiene que llegar a cero—
**134 eran bajas**, y en «Sin tutor y sin ningún dato de contacto», **117 de
118**. En «Familias sin correo», 120 de 265.

**El archivo ya existía.** No hubo que inventar ningún estado: `clients.status`
tenía 120 fichas en `inactive` y `patients.status` 124 en `paused`, emparejadas
120 a 120, y las puso el propio `scripts/import-aumenta.js` al traer el
`activo = false` de Organízate. Lo único que faltaba era que esta pantalla las
mirase. (`discharged` no lo usa nadie: 0 filas.)

**Qué cuenta como baja**: la familia en `inactive` **o** el paciente en `paused`
/ `discharged`. Se miran los dos porque hay 4 pacientes en pausa cuya familia
sigue viva —un hermano que para y otro que sigue—, y con mirar uno solo se
escapan.

### La excepción: quien tiene hora cogida sigue saliendo

La regla no es «fuera las bajas», es **fuera las bajas que no tengan cita
futura**. Salió de los datos: hay **11 pacientes en pausa con 304 citas
confirmadas** del 1/9/2026 al 28/6/2027. Están de baja y tienen el curso entero
ocupado en la agenda; una de las dos cosas está mal, y esconderlos dejaría esas
304 horas bloqueadas sin que nadie pudiera enterarse.

Esos siguen saliendo y salen **marcados** (`de_baja` en cada fila → distintivo
«Archivada» en la pantalla), porque ahí el arreglo no es rellenar un teléfono:
es anular las citas o reactivar la ficha. En la práctica deja las dos carpetas
de «con citas» casi como estaban —sus bajas tienen todas hora— y limpia el resto.

La casilla **«Incluir fichas archivadas»** las devuelve (`?incluirBajas=1`). El
menú (`?soloTotales=1`) **no** la lleva a propósito: su número tiene que ser el
de la pantalla recién abierta, y la pantalla se abre con las bajas fuera.

## Las carpetas no se solapan, y hasta el 25/08/2026 era mentira

La pantalla promete «cada ficha aparece en una sola, para que no la arregles dos
veces». Dos carpetas lo cumplían —`sin_tutor` excluía a las mudas, `sin_contacto`
a las que no tienen tutor— y las otras seis no. Medido en producción:
**1.965 filas para 1.225 fichas**; 726 fichas salían en dos carpetas y 7 en tres.
Cinco solapes, cuatro **completos**:

- los 31 de «con citas y sin terapeuta» estaban TODOS entre los 614 de
  «pacientes sin terapeuta» — por construcción, uno es el otro más un `AND`;
- las 118 de «sin tutor ni contacto» y las 102 de «sin teléfono ni correo»
  estaban TODAS entre las 265 de «sin correo»: quien no tiene ni teléfono ni
  correo, tampoco tiene correo;
- 482 de los 813 de «activos sin ninguna cita» eran los mismos de «pacientes sin
  terapeuta»;
- y 7 salían en las dos carpetas rojas de «con citas» a la vez.

**La regla ahora**: cada ficha sale en la **primera carpeta de `CARPETAS` que le
aplique**, y en ninguna más. Arriba están las urgentes, así que gana siempre la
más urgente. Si al rellenar ese hueco le queda otro, reaparece donde toque: es
una cola, no una lista de todo a la vez.

Y hay una traducción, porque hay carpetas de PACIENTE y carpetas de FAMILIA: el
hueco de «no hay forma de contacto» es de la familia, pero se enseña desde el
paciente cuando ese paciente tiene hora cogida, que es lo urgente. Rellenar el
teléfono tacha las dos filas, así que la familia se calla mientras la esté
enseñando un hijo (`FAMILIA_YA_SALE_POR_UN_HIJO`).

Las dos reglas juntas, en Aumenta:

| Carpeta | Hoy | Con las dos reglas |
| --- | --- | --- |
| Con citas del curso y sin terapeuta | 31 | 31 |
| Con citas del curso y sin forma de contacto | 22 | 15 |
| Sin tutor y sin ningún dato de contacto | 118 | **7** |
| Pacientes sin terapeuta | 614 | 482 |
| Familias sin tutor (localizables) | 0 | 0 |
| Familias sin teléfono ni correo | 102 | 92 |
| Familias sin correo | 265 | **42** |
| Pacientes activos sin ninguna cita | 813 | 332 |
| **Bloquea el trabajo** | **171** | **53** |
| **Ficha incompleta** | **1.794** | **948** |
| **Filas / fichas distintas** | **1.965 / 1.225** | **1.001 / 1.001** |

**Nadie con un hueco real desaparece**, y está comprobado contra los datos de
producción antes de desplegar: de las 225 fichas que dejan de verse, 215 están
de baja y 10 son familias cuyo hueco ya enseña un hijo. **Cero sin explicar y
cero fichas en dos carpetas.** La única que aparece de nuevas es un paciente
activo con terapeuta cuya única cita futura estaba anulada, y aparece donde
tiene que aparecer: en «activos sin ninguna cita».

### Una cita anulada no es «tener hora cogida»

Lo cazó la revisión adversarial previa al despliegue. Cancelar no borra la fila
—`lib/citas/cancelBooking.js` solo le pone `status='cancelled'`, y el import de
Aumenta ya trajo canceladas de Organízate—, así que sin filtrar por estado el
flujo más normal del mundo (dar de baja a alguien **y** anularle las sesiones
del curso) dejaba la ficha rebotando en la pantalla, marcada «Archivada» y con
un aviso falso: «tiene horas cogidas en la agenda». Para la agenda ese hueco
está libre. Las subconsultas que deciden si hay hora cogida llevan ahora
`b.status NOT IN ('cancelled','no_show')` — la misma lista que `ocupaHuecoWhere`
de `lib/citas/booking.js`, `lib/home/summary.js` y `caducidadRetencion.js`.

Las columnas de detalle que miran hacia atrás (`última cita`) **no** llevan ese
filtro a propósito: ahí la pregunta es «¿cuándo se le vio por última vez?», y
una cita anulada también es una fecha en la que hubo trato.

El solape que queda es **por familia y a propósito**: un paciente sin terapeuta
cuya familia no tiene correo sale dos veces, una por cada hueco, porque son dos
arreglos distintos sobre dos fichas distintas. La promesa habla de fichas.

### Archivar y reactivar, desde la ficha

`clients.status` no se veía ni se podía cambiar en ninguna pantalla. Ahora la
ficha de familia lleva un distintivo «Archivada» en la cabecera y un botón
**Archivar ficha / Reactivar ficha** junto a Editar; el listado de `/clientes`
enseña el mismo distintivo. Archivar **no es de admin** (se deshace con el mismo
botón); borrar sí lo es, y eso sigue igual.

**Archivar no esconde la ficha en ningún sitio**, y hubo que arreglar un caso
para que eso fuera verdad. `app/api/citas/clientes` —el buscador del alta manual
de citas— empezaba su `where` por `status <> 'inactive'`, así que una familia
archivada desaparecía de él. Suena razonable hasta que se junta con la salida a
mano que ese buscador tiene a propósito: se archiva a una familia, vuelve a los
dos meses a pedir hora, recepción teclea el nombre, no sale nadie, escribe el
nombre a mano y **la cita nace con `client_id = null`** — suelta de su ficha, que
es justo el fallo que ese buscador vino a arreglar en julio de 2026.

Desde el 25/08/2026 las ofrece, marcadas «Archivada» y detrás de las vivas,
pero **con cupo propio**: dos consultas, las vivas con el tope de siempre (20) y
las archivadas con cinco plazas garantizadas. La primera versión las ordenaba al
final en una sola consulta, y la revisión hizo la cuenta: con 1.083 fichas y tope
20, teclear «garcía» llena las 20 plazas con familias vivas y la archivada no
entra **nunca** — el mismo agujero, con más pasos. Y el desplegable avisa cuando
hay más resultados de los que caben, porque una lista llena y una lista completa
se ven igual, y ahí es donde se tira de la salida a mano.

Con esto, **el único sitio donde archivar sigue escondiendo una ficha es
«Fichas a completar»** (`lib/clients/urgentes.js`), y allí es a propósito: es lo
que se pidió, y tiene su casilla «Incluir fichas archivadas». Lo fija
`scripts/_smoke-citas-buscador-archivadas.mjs`.

⚠️ Esa regla —«solo ahí»— **está escrita aquí y no comprobada por ninguna
prueba**, y es a propósito. Se intentó un barrido de todo el repo y saca 19
ficheros que consultan fichas y filtran algo por estado; en casi todos el
`status` es de otra cosa (una factura, una cita, un pedido, un ticket), y un
regex por fichero no sabe de quién es cada uno — `active` e `inactive` los usan
también el paciente, el empleado y el proyecto. Una lista blanca de 19 entradas
diciendo «este no cuenta» no es una red: es algo que nadie mantiene. Así que la
prueba comprueba este buscador con nombre y apellidos, y **si algún día se añade
otro sitio que filtre fichas por estado, hay que acordarse de mirar aquí**.

⚠️ **La llave del cuerpo es `archivada`, no `status`.** En
`app/api/clients/[id]` el `body.status` YA está cogido: es el embudo comercial y
acaba en `customFields.seStatus`, que es otro campo distinto aunque el nombre lo
parezca (por eso en la cabecera conviven el distintivo «Nuevo» y el
«Archivada»). Con la misma llave para las dos, guardar el embudo se llevaría por
delante el archivo. Y solo se toca si el valor CAMBIA, para no perder `prospect`
por el camino.

### Dos trampas de las consultas crudas que costaron una tarde

Las dos estaban en `lib/clients/urgentes.js` y las dos son de cualquier
`sequelize.query()` del repo:

1. **`coalesce(c.status::text, '')`, no `coalesce(c.status, '')`.** `status` es
   un ENUM: sin el cast, PostgreSQL intenta meter la cadena vacía dentro del
   enum y revienta en la primera consulta. Y el `coalesce` tampoco sobra: dos
   carpetas llegan a `clients` por un LEFT JOIN, y sin él un paciente sin
   familia da `NULL = 'inactive'` → NULL, el `NOT (...)` también sale NULL y la
   fila se cae por no tener familia. Ese segundo fallo **no daría ningún error**.
2. **Nunca `SELECT table_name FROM information_schema.tables` para saber si una
   tabla existe.** El dialecto de Postgres de Sequelize reconoce esa forma como
   «listar tablas» y le cambia la FORMA al resultado: devuelve los nombres
   sueltos y repartidos entre los dos huecos de la tupla
   (`[["bookings"],["patients"]]`), así que `filas.map(f => f.table_name)` da
   `[undefined]` y el centro se queda sin sus carpetas de pacientes **sin dar
   ningún error**. Se pregunta con `to_regclass('"crm_x"."tabla"')`, que además
   obliga a escribir el schema — que es la otra trampa, la del `searchPath`
   (ver `docs/modules/pacientes.md`).

Lo fija `scripts/_smoke-clients-urgentes-bajas.mjs` (25 comprobaciones), que
además compara el WHERE del listado con el del recuento carpeta por carpeta —la
regla de que el número y las filas salgan de la misma fuente— y que cada carpeta
sigue callándose lo que ya enseña otra por encima.

## WhatsApp sin asignar (17/08/2026)

`/clientes/whatsapp` — los mensajes que llegan de números que **no están en
ninguna ficha**. `whatsapp_messages` los guarda a propósito (un familiar, un
número nuevo, alguien que aún no es paciente: tirarlos sería el fallo que el
módulo viene a evitar), pero hasta esta pantalla el único sitio donde se veían
era la ficha de un cliente — o sea que **se estaban guardando para nadie**.

- Una fila por **NÚMERO**, no por mensaje: lo que se decide es «esta
  conversación es de esta persona», y eso se decide una vez aunque haya veinte
  mensajes debajo. La consulta agrupa con funciones de ventana, así que es UNA
  llamada a la base y no una por conversación.
- Gatea por **`clients` a secas**, no por `clients_avanzado`: «Fichas a
  completar» resuelve el problema de un centro con miles de huecos importados y
  esto resuelve uno que tiene cualquiera que use WhatsApp. Tampoco se gatea por
  ningún módulo de WhatsApp porque no existe: es una integración universal
  (regla #14).
- **La entrada del menú se esconde cuando no hay nada** (`waSueltos` en
  `Sidebar.jsx`), igual que «Fichas a completar». Aquí el criterio del `null` va
  al revés: mientras no se sepa, NO se enseña — la mayoría de clientes no tienen
  WhatsApp y para ellos estaría siempre a cero.

⚠️ **Asignar tiene que ser definitivo, o esto es una noria.** Además de
enganchar los mensajes sueltos, el número se guarda en la ficha como
`ClientContactMethod` (kind `phone`, etiqueta «WhatsApp», **nunca principal**) y
`buscarClientePorTelefono` mira ahora también esa tabla. Sin eso, el siguiente
mensaje del mismo número volvería a caer en la bandeja y habría que asignarlo
otra vez cada semana.

El principal NO se toca nunca: es el que usan facturación, los avisos de cita y
el acceso al portal, y un número que apareció en un mensaje no puede desplazar
al que la persona dio en su alta. Solo se tocan los mensajes con `client_id`
NULL: reasignar en lote lo que alguien ya decidió sería pisarle el trabajo.

La asignación queda **auditada** (`whatsapp.conversacion_asignada`): no es
destructivo ni mueve dinero, pero decide quién puede LEER una conversación.

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
| Historia clínica (antes "Notas") | `components/clients/ClientNotesPanel.jsx` ⁽²⁾ | `GET/POST /api/clients/:id/notes`, `DELETE /api/clients/:id/notes/:noteId` | Paginación incremental "Cargar más" (limit 50). Sin restricción de borrado por autor (Laura es única usuaria) |
| Documentos (antes "Adjuntos") | `components/clients/ClientAttachmentsPanel.jsx` ⁽²⁾ | `GET/POST /api/clients/:id/attachments`, `DELETE`, `GET .../download`, `PATCH` (visibilidad), `GET /contract` (firmas) | Drop zone + validación frontend (cualquier tipo, ≤25MB, ≤50 archivos); «que la paciente lo vea»; tarjeta Firmas |
| Sesiones (antes "Citas") | `components/clients/ClientBookingsPanel.jsx` ⁽²⁾ | `GET /api/citas/bookings?clientId=&clientEmail=`, `PATCH .../confirm`, `PATCH .../reject` | En la consulta cada cita ES una sesión de seguimiento. Confirm/Reject inline para `pending` con mini-modal opcional para motivo |
| Pautas (antes "Plan") | `ClientPlansPanel.jsx` (`modules/nutricion/`) | `GET /api/clients/:id/plans`, `POST /api/nutricion/plans/:id/reapply-template` | Plan activo + histórico archivado (Recetario C4) |

⁽²⁾ **Desde el 18/08/2026 los tres paneles son compartidos** (ver la ficha
default, arriba): esta ficha los importa de `components/clients/` y les pasa
sus palabras de siempre por la prop `textos` (`TEXTOS_LAURA`: «la paciente»,
«Sesiones del paciente»…), así que Laura ve lo mismo que veía. Lo que queda de
propio en `modules/overrides/nutri-laura/ClientDetailModule.jsx` es la
cabecera de paciente (edad, DNI, contacto, lead de origen), la tarjeta de
datos con su edición y el reparto en cinco pestañas.

**Permisos**: el detalle hace gate por `me.role ∈ {admin, superadmin, employee}`
fetcheando `/api/auth/me` al montar. Sin rol válido → "Sin acceso".

**Header**: back link a `/clientes`, nombre, status chip (Paciente activo, En
seguimiento…), edad/email/teléfono inline, link "↳ Lead origen" si
`client.leadId` (o `customFields.leadId` por compat).

**`InteractionsLegacySection`**: estuvo archivado en
`modules/overrides/nutri-laura/_InteractionsLegacySection.jsx` (con prefijo
`_` para indicar no-importado) y **se borró el 18/08/2026**: nadie lo importaba
desde junio, y su equivalente vivo es la tarjeta «Historial de interacciones»
de la ficha default. La tabla `interactions` no existe en `crm_nutri_laura`
(ni en `crm_retorika`), así que la sección desapareció del tab Información. El
backend `GET /api/clients/:id` tolera la tabla missing con try/catch del 42P01 —
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
nutrición)**: en tenants con el módulo `nutricion` activo **Y el flag
`autoAsignarEnAlta` encendido**, TODA alta de cliente marca sola la asignación
`nutricion` (`AUTO_ASSIGN_MODULE_KEYS` + `AUTO_ASSIGN_FLAG` +
`applyAutoAssignments` en `lib/clients/moduleAssignments.js`). Cubre los tres
caminos de alta: POST `/api/clients` (manual y conversión de lead),
aceptar solicitud de Formularios e importación masiva. Siempre FUERA de la
transacción del alta y best-effort (`findOrCreate` sobre el único, tolera tabla
sin migrar): un fallo del extra no tumba el alta. Decide con `tenantHasModule`
(módulo del tenant), no `hasModule` (que exige además el moduleAccess del
usuario que crea la ficha). `clinica` queda EXPRESAMENTE fuera: Aumenta pidió
paciente siempre explícito. Metadata `{auto: true}` distingue el marcado
automático del manual.

⚠️ **DEJÓ DE SER INCONDICIONAL EL 13/08/2026.** Colgaba solo de tener el módulo,
y eso se escribió para una consulta de una persona, donde «todo cliente nuevo es
paciente» es verdad. En un centro grande deja de serlo: el día que Nutrición se
venda a un centro de psicología con 1.083 familias, toda ficha que entre por la
puerta quedaría marcada como paciente de dietas —incluidas las que van a terapia
y no pisan la consulta— y sin nada que lo dijera. Ahora manda
`featureFlags.autoAsignarEnAlta` en la fila de `nutricion` de
`master.tenant_modules`, **apagado por defecto**; `nutri_laura` lo tiene
encendido desde `scripts/migrate-auto-asignar-nutricion.js`, que existe
precisamente para que el cambio no le moviera el suelo a quien ya dependía del
comportamiento viejo. Es la misma lección que «Fichas a completar»: lo que
resuelve el problema de una consulta de una persona no es el default de un centro
de veinte.

**Migración + backfill** (`scripts/migrate-client-module-assignments.js`): corre
en **todos** los tenants con `clients` (lista leída de `master.tenants` en
runtime) y hace dos cosas. La fase B, para todos: crea
`client_module_assignments` y, donde exista `patients`, añade
`patients.client_id`. La fase C, **solo en `crm_nutri_laura`**: marca
`nutricion` a los clients con plan asignado activo **o** `origin='lead'`.
Idempotente; no toca los dados de alta a mano. Está además en el bloque
`clients` de `scripts/_module-migrations.js`, así que `enable-module.js` la
arrastra.
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
