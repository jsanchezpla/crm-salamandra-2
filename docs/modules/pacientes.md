# Módulo Pacientes (`pacientes`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `pacientes` · requiere `clients` (el paciente cuelga de la familia que paga; `lib/provisioning/catalogo.js` y `lib/provisioning/dependencias.js`, que además marca `team` y `citas` como parciales: sin ellos la ficha pierde el desplegable de terapeuta y las citas). Sus endpoints abren con `pacientes` **o** `clinica`; `clinica` lo exige como obligatorio. |
| **Reina** | `aumenta` — 1.174 pacientes en producción, hijos de 1.083 familias (`clients`): es el centro donde el paciente NO es quien paga, que es la razón de que exista esta tabla aparte de `clients`. |
| **Pantallas** | `app/(dashboard)/pacientes/` (3): `/pacientes` (listado paginado con KPIs, búsqueda por nombre y filtros por terapeuta y estado; alta con especialidades), `/pacientes/[id]` (ficha: datos, consentimientos, contactos externos, plan de intervención, sesiones, informes, coordinaciones, documentos, facturación), `/pacientes/[id]/sesiones/nueva` (subir audio → transcribir → revisar → guardar). En el menú es el primer hijo del grupo «Clínica» (`components/layout/Sidebar.jsx`), no una entrada raíz. `pacientes/_components/dummyData.js` es resto de la maqueta: no lo importa ninguna página. |
| **Endpoints** | `app/api/pacientes/**` (11 `route.js`): `pacientes` (listar/crear), `[id]` (ficha/editar/borrar), `[id]/plan` (plan de intervención), `[id]/contactos/**` (2, agenda de profesionales externos), `[id]/documents/**` (3, adjuntos del paciente), `[id]/contract` (solo descarga los PDF legado que la migración no pudo mover), `contract-template/**` (2, contrato estándar del centro). Ninguno gasta IA. El registro clínico del paciente (sesiones, informes, coordinaciones) va por `app/api/clinica/**` (ver `clinica.md`). También crean o leen pacientes: `app/api/clients/route.js` (el alta de la familia crea a los suyos en la misma transacción), `app/api/clients/[id]/module-assignments/route.js`, `app/api/formularios/[id]/accept/route.js` y `app/api/citas/bookings/**` (una cita apunta a `patient_id`). |
| **Lógica** | No hay `lib/pacientes/`: vive en `lib/clinica/` — `serialize.js` (`serializePatient`, etiquetas de estado y `care_type`), `specialties.js` (taxonomía compartida con Equipo), `consents.js` (consentimientos RGPD con traza legal), `contractStorage.js` (PDF legado por paciente), `patientClient.js` (de qué cliente es un paciente), `audit.js` — y en `lib/clients/`: `formularioAlta.js` (`normalizarPacientes`, perfil `salud`), `moduleAssignments.js` (`syncClinicPatient`). |
| **UI** | Sin `modules/pacientes/` ni `components/pacientes/`. Las piezas están en `components/clinica/` (`SpecialtyPicker.jsx`, `PatientDocumentsSection.jsx`, `PatientExternalContactsSection.jsx`, `InterventionPlanSection.jsx`, `NuevaCoordinacionModal.jsx`) y en `components/clients/` (`PacientesDelAlta.jsx`, `ClientPatientsSection.jsx`: los pacientes vistos desde la ficha de la familia). |
| **Modelos** | `Patient` → `patients` (`models/tenant/Patient.model.js`; hoy con `client_id` al pagador, `care_type` terapia/nutrición, `specialties`, `objectives`, `consents`, `dni`, `address`, `relationship`, y `contract_signed`/`contract_file` como legado) · `ExternalContact` → `external_contacts` · `InterventionPlan` → `intervention_plans`. Las FK de `clinic_sessions`, `clinical_reports` y `coordinations` apuntan aquí, no a `clients`. |
| **Interruptores y parámetros** | ninguno que lea el código. |
| **Pantallas propias** | ninguna. |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> pacientes` (avisa si falta `clients`; `ensure-tenant-schema.js` corre las 6 del bloque `pacientes` de `scripts/_module-migrations.js`: `migrate-patients-clients-phase1`, `migrate-client-module-assignments`, `migrate-patients-multi-per-client`, `migrate-patients-care-type`, `migrate-patients-specialties`, `migrate-documents-patient-link`. ⚠️ La tabla `patients` la crea `migrate-clinica-module`, que está solo en el bloque `clinica`). Seed: `seed-clinica-demo.js <slug>` (pacientes + clínica; **VACÍA** antes, solo escaparate). Datos, a mano y con dry-run: `backfill-patients-client.js` (paciente → pagador deducido de sus citas/sesiones, `--confirm`; no cruza por nombre a propósito) y `migrate-contract-patient-to-client.js` (contrato del paciente → familia, ya corrido). ONE_OFF de la maqueta, no usar: `migrate-pacientes-sprint-1.js` (solo `crm_aumenta`). |
| **Pruebas** | `scripts/_smoke-alta-progenitores.mjs` — entra en `npm test`, sin base de datos: `normalizarPacientes` (el motivo llega hasta lo que se guarda) y el alta con dos progenitores. Ninguna otra toca `patients`: `_smoke-borrar-paciente.mjs` y `_smoke-paciente-borrado.mjs` son de `clients` (la «paciente» de una consulta de nutrición es un `Client`). |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` · `../decisions/2026-08-01-alta-de-clientes-por-perfil.md` · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` |
| **En este doc** | Decisión arquitectónica: `patients` ≠ `clients` · Estado: Fase 1 (backend real) · Modelo · Frontend · Migración · Decisiones cerradas |

> Documentación de detalle. Referencia rápida en `CLAUDE.md`. Si
> encuentras una discrepancia con el código, **prevalece el código**:
> actualiza este fichero.

## Visión general

Módulo de gestión de pacientes pediátricos para un centro de
psicopedagogía. Maneja la ficha clínica (centro escolar, curso
académico, motivo de derivación, terapeuta principal, frecuencia,
estado del tratamiento) y el timeline de sesiones / informes /
coordinaciones de cada paciente.

Implementado como **sprint visual** complementario al módulo
[Clínica](clinica.md) para la demo del **9 de junio de 2026** con el
equipo de Aumenta.

Activado **solo en aumenta** vía `master.tenant_modules`
(`moduleKey='pacientes'`).

## Decisión arquitectónica: `patients` ≠ `clients`

Aumenta tiene activos los módulos `clients` y `pacientes`
simultáneamente. **Son tablas separadas e independientes**:

- `clients` (tabla `clients`, modelo `Client`): cliente comercial
  estándar del CRM. No se usa en el flujo clínico de Aumenta.
- `patients` (tabla `patients`, modelo `Patient`): paciente clínico
  con campos pediátricos (centro escolar, motivo derivación,
  terapeuta principal, frecuencia de asistencia, estado del
  tratamiento).

**Las FKs del módulo Clínica apuntan a `patients`**:

- `clinic_sessions.patient_id` → `patients.id` (NOT NULL, RESTRICT).
- `coordinations.related_patient_id` → `patients.id` (nullable, SET NULL).
- `clinical_reports.patient_id` → `patients.id` (NOT NULL, RESTRICT).

El script `migrate-pacientes-sprint-1.js` realiza esta migración
correctiva tras el sprint Clínica: dropea las columnas `client_id`
originales y añade las `patient_id` correctas.

### Por qué dos tablas y no una

Decisión tomada con Jorge el **8 de junio de 2026**: mantener
separados los conceptos comercial (cliente) y clínico (paciente)
hasta que un sprint futuro evalúe si conviene fusionarlos. En el
contexto de Aumenta el solapamiento conceptual sería bajo: muy
pocos pacientes son a la vez "clientes comerciales" del CRM. Por
ahora, separados.

## Estado: Fase 1 (backend real)

`/pacientes` (listado) y `/pacientes/[id]` (ficha) leen y escriben datos reales vía
`/api/pacientes/*` y `/api/clinica/*`: listar con filtros, ficha con tabs
(sesiones/informes/coordinaciones), crear paciente, editar ficha, crear informe y
marcar sesión publicada. La tabla `patients` ya **no** es aumenta-only: la migración
`scripts/migrate-clinica-module.js` la crea en cualquier tenant con el módulo
(lee `master.tenants`).

**Fase 3 (real):** `/pacientes/[id]/sesiones/nueva` sube el audio → Whisper (OpenAI)
transcribe → Claude estructura → la terapeuta revisa/edita → se guarda como
`ClinicSession`. (Modo demo *canned* en local sin claves.)

> El resto del documento (Sprint 1, dummy `p-1`, etc.) es histórico; la ficha ya no
> depende de `isDiego` y todos los pacientes muestran sus datos reales.

## Lo que NO hace (Sprint 1)

- No hay endpoints CRUD (`/api/pacientes/*` no existe).
- No persiste sesiones, informes ni coordinaciones (todo dummy).
- No graba audio. La grabación se hace **fuera del CRM** (móvil de
  la terapeuta) y se sube como archivo — ver "Flujo de subida de
  audio".
- No transcribe ni estructura con IA real.
- No envía notificaciones a familias ni al colegio.
- No filtra pacientes por terapeuta logueado (todos los admin ven
  todos).
- No tiene búsqueda avanzada (solo búsqueda por nombre y filtros
  básicos de terapeuta / estado).

## Modelo

### Patient

Fichero: `models/tenant/Patient.model.js`. Tabla: `patients`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `firstName` | VARCHAR(120) NOT NULL | Nombre del paciente. |
| `lastName` | VARCHAR(120) NOT NULL | Apellidos. |
| `birthDate` | DATEONLY nullable | Fecha de nacimiento. |
| `age` | INTEGER nullable | Edad (0-120). Guardada para demo; en flujo real debería calcularse. |
| `educationCenter` | VARCHAR(200) nullable | Centro escolar (ej. "CEIP Las Acacias"). |
| `educationLevel` | VARCHAR(80) nullable | Curso académico (ej. "3º Primaria"). |
| `referralReason` | TEXT nullable | Motivo de derivación. |
| `referredBy` | VARCHAR(120) nullable | Quién derivó al paciente (orientador, pediatra, familia, etc.). |
| `mainTherapistId` | UUID nullable | FK a `team_members` (ON DELETE SET NULL). |
| `enrollmentDate` | DATEONLY nullable | Fecha de alta en el centro. |
| `attendanceFrequency` | VARCHAR(50) nullable | Frecuencia ("Semanal", "Quincenal"). |
| `status` | ENUM NOT NULL | `active`, `paused`, `discharged`. Default `active`. |
| `dischargeDate` | DATEONLY nullable | Fecha de alta médica (cuando aplica). |
| `dischargeReason` | TEXT nullable | Motivo del alta. |
| `notes` | TEXT nullable | Notas internas. |

Índices: `(last_name, first_name)`, `(main_therapist_id)`, `(status)`.

> **Contrato: ya no es del paciente** (sprint Aumenta 2026-07, punto 1.1).
> `contractSigned` y `contractFile` quedan como **legado**: el contrato pasó a
> la familia (`clients.contract_document_id` + `documents.source='contrato'`),
> porque quien firma y quien paga son los padres y dos hermanos en el centro
> generaban dos contratos para una misma familia. Se sube y se borra en
> `/api/clients/[id]/contract`; la ficha del paciente solo lo muestra y enlaza
> a la del cliente. `GET /api/pacientes/[id]/contract` sigue vivo únicamente
> para descargar los PDF que la migración no pudo mover (pacientes sin cliente
> pagador). Detalle y migración: `docs/modules/clients.md` → «Contrato del
> Centro».

Enum: `enum_patients_status` con valores `active`, `paused`,
`discharged`.

## Frontend

En el sidebar, **Pacientes no es una entrada raíz**: cuelga como primer
sub-ítem del grupo **Clínica** (sección "Empresa"). Ver
[`docs/modules/clinica.md`](clinica.md) → Sidebar. Las rutas siguen siendo
`/pacientes*` (no cambian).

Tres páginas en `app/(dashboard)/pacientes/`.

| Ruta | Propósito |
| --- | --- |
| `/pacientes` | Listado. 4 KPIs **calculados desde el array dummy** (no inventados). Filtros: búsqueda por nombre, terapeuta, estado. Tabla de 6 filas con avatar + nombre + centro + motivo + terapeuta + última sesión + estado + acción "Ver ficha". |
| `/pacientes/[id]` | Ficha. Cabecera con avatar grande, datos clave, 3 botones (CTA "Subir audio", "Nuevo informe", "Editar ficha"). 4 tabs: Resumen, Sesiones, Informes, Coordinaciones. |
| `/pacientes/[id]/sesiones/nueva` | Flujo de subida de audio con 4 estados. La pantalla "estrella" de la demo. |

### Particularidades del listado

KPIs derivados del array `PATIENTS` (no hardcoded inventados):
- "Pacientes activos" = `filter(status === 'active').length`.
- "En pausa" = `filter(status === 'paused').length`.
- "Altas" = `filter(status === 'discharged').length`.
- "Sesiones registradas" = `DIEGO_SESSIONS.length`.

Si se cambian los pacientes en `dummyData.js`, los KPIs se actualizan
solos.

### Ficha del paciente

Cabecera fija con avatar circular (color por paciente), nombre + chip
de estado, datos clave (centro, terapeuta, fecha alta, frecuencia), 3
botones laterales.

Tabs:

1. **Resumen**: Cards de motivo, objetivos terapéuticos, próximas
   citas, documentos adjuntos.
2. **Sesiones**: timeline vertical. Click en una sesión abre un
   drawer con detalle completo (audio fake + transcripción +
   apartados estructurados). Respeta la regla #13 (`top-14 lg:top-0`).
3. **Informes**: listado de informes evolutivos / admisión / alta.
4. **Coordinaciones**: actas con familia, colegio, externos.

**Solo Diego Martín (`id="p-1"`) tiene datos completos**. Los otros 5
pacientes son placeholders: la ficha existe y se navega, pero los
tabs muestran empty states ("Sin sesiones registradas en esta demo").

### Flujo de subida de audio

La pantalla `/pacientes/[id]/sesiones/nueva` es el "wow moment" de la
demo. Cuatro estados manejados con `useState`:

1. **`IDLE`**: zona drag-and-drop con icono cloud-upload. Texto:
   "Sube el audio grabado con tu móvil. La IA lo transcribirá y
   estructurará en apartados." Formatos admitidos m4a/mp3/wav/ogg.
   Click o drop → estado `UPLOADED`.
2. **`UPLOADED`**: muestra el archivo fake (`sesion-diego-5jun.m4a · 0:47 · 1.2 MB`)
   con player + botones "Cambiar archivo" / "Procesar con IA". Click
   en "Procesar" → estado `PROCESSING`.
3. **`PROCESSING`**: spinner + lista animada de 5 pasos
   (~3 segundos de auto-avance):
   - Subiendo audio…
   - Transcribiendo con Whisper…
   - Identificando objetivos trabajados…
   - Estructurando observaciones…
   - Listo.
   Auto-transición a `STRUCTURED`.
4. **`STRUCTURED`**: 2 columnas. Izquierda: audio + transcripción
   literal del documento original de Aumenta ("Hoy hemos trabajado
   atención con un memory…"). Derecha: bloque estructurado con
   objetivos chips + actividades + desempeño + observaciones
   sub-divididas (familia / próxima / casa / incidencias). Footer
   con botones Cancelar / Regenerar / **Guardar sesión**.

**El CRM no graba sesiones**. La grabación se hace en el móvil de la
terapeuta con cualquier app de notas de voz. El CRM solo recibe el
archivo y lo procesa. Esto fue una decisión explícita: simplificar
el ámbito del producto y delegar la grabación al dispositivo.

## Migración

`scripts/migrate-pacientes-sprint-1.js`. Solo schema `crm_aumenta`
(hardcoded). Idempotente.

Cuatro fases:

1. **Fase A** (autocommit): `CREATE TYPE enum_patients_status`.
2. **Fase B** (transacción): `CREATE TABLE patients` + 3 índices + FK a `team_members`.
3. **Fase C** (transacción): para cada tabla del módulo Clínica
   (`clinic_sessions`, `coordinations`, `clinical_reports`):
   - Verifica que la tabla está vacía (assert; aborta si no).
   - Drop FK + drop column `client_id` / `related_client_id`.
   - Drop índice de la versión anterior.
   - Add column `patient_id` / `related_patient_id` con FK a
     `patients` y el `ON DELETE` correcto (RESTRICT si NOT NULL,
     SET NULL si nullable).
   - Add índice nuevo.
4. **Fase D** (transacción): activar `pacientes` en
   `master.tenant_modules` para aumenta.

```bash
npm run db:migrate:pacientes         # local
npm run db:migrate:pacientes:prod    # VPS
```

**Orden importa**: ejecutar **después** de
`migrate-clinica-sprint-1.js`. Si las tablas de Clínica no existen,
la fase C las salta con mensaje informativo.

## Tenants

| Tenant | Módulo `pacientes` | Notas |
| --- | --- | --- |
| `aumenta` | activo | Único tenant con el módulo. |
| Resto | inactivo | Mantienen su `clients` estándar sin interferencia. |

`'pacientes'` **no** está en `ALL_MODULES` (`scripts/db-sync.js`);
se gestiona manualmente vía `tenant_modules`.

## Coherencia con sprint Clínica

Los datos dummy de Pacientes están **alineados con los de Clínica**:

- Diego Martín (`p-1`, 8 años, CEIP Las Acacias, 3º Primaria) es el
  paciente del informe extenso de `/clinica/informes`.
- Su terapeuta principal **Lorena Vázquez** (`t-1`) es la
  protagonista del dashboard `/equipo/mi-desempeno` con 87/100.
- El array de terapeutas (`THERAPISTS`) se **importa desde
  `clinica/_components/dummyData.js`** vía re-export en
  `pacientes/_components/dummyData.js`. Cambiar terapeutas: editar
  un único fichero.

## Backlog (Sprint 2+)

- Endpoints CRUD para `Patient` (POST/PATCH/DELETE + listado
  paginado con búsqueda real en BD).
- Persistencia real del flujo de subida de audio:
  - Upload del archivo a almacenamiento (S3-compatible / disco).
  - Pipeline asíncrono: Whisper → OpenAI estructuración → insert en
    `clinic_sessions`.
  - WebSocket o polling para refrescar el estado del procesamiento.
- Adjuntos en informes (`ClinicalReport.attachments`) con subida real
  de PDFs / imágenes.
- Filtros avanzados en el listado: por edad, centro escolar,
  frecuencia, rango de fechas.
- Vinculación opcional `Patient` ↔ `Client` por si un paciente
  pediátrico también es cliente facturable del centro (decisión
  pendiente).
- Roles: terapeuta ve solo sus pacientes; dirección ve todos.
- Validaciones del formulario "Editar ficha" (hoy decorativo).
- Auditoría: registrar en `master.AuditLog` cambios de estado
  (alta médica, pausa, reanudación).

## Decisiones cerradas

- **Tabla independiente de `clients`** (8 jun 2026).
- **Las FKs de Clínica se mueven de `clients` a `patients`** en la
  migración correctiva. Las tablas estaban vacías → sin pérdida de
  datos.
- **El CRM no graba audio**, solo lo recibe.
- **Un único paciente con datos completos** en la maqueta (Diego
  Martín). Los otros 5 son placeholders honestos (la ficha existe
  pero los tabs muestran empty state explícito).
- **KPIs derivados** del array `PATIENTS`, no inventados, para
  evitar incoherencias visuales del tipo "42 activos · 6 visibles".
