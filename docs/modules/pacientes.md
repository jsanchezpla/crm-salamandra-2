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
| **Pantallas** | `app/(dashboard)/pacientes/` (3): `/pacientes` (listado paginado con KPIs, búsqueda por nombre y filtros por terapeuta y estado; alta con especialidades), `/pacientes/[id]` (ficha: datos, consentimientos, contactos externos, plan de intervención, sesiones, informes, coordinaciones, documentos, facturación; desde el 02/09/2026 también «Padres y tutores» de la familia en solo lectura —nombre, parentesco, teléfono y correo, sin DNI— porque las terapeutas no entran en Clientes, AV-0023/0024 de Aumenta: `tutoresParaFicha` en `lib/clients/guardians.js`, fijado en `scripts/_smoke-tutores-ficha-paciente.mjs`), `/pacientes/[id]/sesiones/nueva` (subir audio → transcribir → revisar → guardar). En el menú es el primer hijo del grupo «Clínica» (`components/layout/Sidebar.jsx`), no una entrada raíz. Ya no hay `pacientes/_components/`: su único fichero, el `dummyData.js` de la maqueta, se borró el 20/08/2026 por no importarlo ninguna página (ver «Coherencia con sprint Clínica»). |
| **Endpoints** | `app/api/pacientes/**` (11 `route.js`): `pacientes` (listar/crear), `[id]` (ficha/editar; no hay DELETE), `[id]/plan` (plan de intervención) + `[id]/plan/objetivos-ia` ⚡ **Claude** (02/09/2026, AV-0019 de Aumenta: de las ideas clave de la terapeuta a objetivos de intervención adaptados al paciente; NO guarda nada, la propuesta se marca y se añade al plan desde `components/clinica/InterventionPlanSection.jsx`; clave BYOK + `vetoAi` + demo simulada; al modelo no viaja el nombre del paciente — `lib/clinica/objetivosIa.js`, fijado en `scripts/_smoke-objetivos-ia.mjs`), `[id]/contactos/**` (2, agenda de profesionales externos), `[id]/documents/**` (3, adjuntos del paciente), `[id]/contract` (solo descarga los PDF legado que la migración no pudo mover), `contract-template/**` (2, contrato estándar del centro). Solo `[id]/plan/objetivos-ia` gasta IA. El registro clínico del paciente (sesiones, informes, coordinaciones) va por `app/api/clinica/**` (ver `clinica.md`). Desde el 01/09/2026 la ficha **pone el resultado de sus citas** sin salir de ella (completada · falta justificada · falta injustificada · cancelada) por el PATCH de siempre `app/api/citas/bookings/[id]`: la pieza es `components/citas/CitasDelPaciente.jsx` y lo que se manda lo arma `lib/citas/resultadoCita.js`, el mismo que usa la ficha de la cita en la Agenda. También crean o leen pacientes: `app/api/clients/route.js` (el alta de la familia crea a los suyos en la misma transacción), `app/api/clients/[id]/module-assignments/route.js`, `app/api/formularios/[id]/accept/route.js` y `app/api/citas/bookings/**` (una cita apunta a `patient_id`). |
| **Lógica** | No hay `lib/pacientes/`: vive en `lib/clinica/` — `serialize.js` (`serializePatient`, etiquetas de estado y `care_type`), `specialties.js` (taxonomía compartida con Equipo), `consents.js` (consentimientos RGPD con traza legal), `contractStorage.js` (PDF legado por paciente), `patientClient.js` (de qué cliente es un paciente), `audit.js` — y en `lib/clients/`: `formularioAlta.js` (`normalizarPacientes`, perfil `salud`), `moduleAssignments.js` (`syncClinicPatient`). |
| **UI** | Sin `modules/pacientes/` ni `components/pacientes/`. Las piezas están en `components/clinica/` (`SpecialtyPicker.jsx`, `PatientDocumentsSection.jsx`, `PatientExternalContactsSection.jsx`, `InterventionPlanSection.jsx`, `NuevaCoordinacionModal.jsx`) y en `components/clients/` (`PacientesDelAlta.jsx`, `ClientPatientsSection.jsx`: los pacientes vistos desde la ficha de la familia). |
| **Modelos** | `Patient` → `patients` (`models/tenant/Patient.model.js`; hoy con `client_id` al pagador, `care_type` terapia/nutrición, `specialties`, `objectives`, `consents`, `dni`, `address`, `relationship`, y `contract_signed`/`contract_file` como legado) · `PatientTherapist` → `patient_therapists` (25/08/2026: quién lleva al paciente, uno por fila, con su `specialty`; **sin asociaciones de Sequelize a propósito** —ver abajo—) · `ExternalContact` → `external_contacts` · `InterventionPlan` → `intervention_plans`. Las FK de `clinic_sessions`, `clinical_reports` y `coordinations` apuntan aquí, no a `clients`. |
| **Interruptores y parámetros** | ninguno que lea el código. |
| **Pantallas propias** | ninguna. |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> pacientes` (avisa si falta `clients`; `ensure-tenant-schema.js` corre las 7 del bloque `pacientes` de `scripts/_module-migrations.js`: `migrate-clinica-module` (la primera: crea `patients` y las tablas clínicas; desde el 19/08/2026 está también en este bloque), `migrate-patients-clients-phase1`, `migrate-client-module-assignments`, `migrate-patients-multi-per-client`, `migrate-patients-care-type`, `migrate-patients-specialties`, `migrate-documents-patient-link`, `migrate-patients-terapeutas`). Seed: `seed-clinica-demo.js <slug>` (pacientes + clínica; **VACÍA** antes, solo escaparate). Datos, a mano y con dry-run: `backfill-patients-client.js` (paciente → pagador deducido de sus citas/sesiones, `--confirm`; no cruza por nombre a propósito) y `migrate-contract-patient-to-client.js` (contrato del paciente → familia, ya corrido) y `backfill-patients-terapeutas.js` (copia el terapeuta de la ficha a la lista; **opcional**, ver abajo). ONE_OFF de la maqueta, no usar: `_hechos/migrate-pacientes-sprint-1.js` (solo `crm_aumenta`). |
| **Pruebas** | `scripts/_smoke-busqueda-nombre.mjs` (`node:test`, 28/08/2026, en `npm test`, 49 casos): la regla del buscador —todas las palabras, cada una en cualquier columna, sin importar orden ni tildes— y que el endpoint sigue llamándola con las columnas cualificadas. · `scripts/_smoke-alta-progenitores.mjs` — entra en `npm test`, sin base de datos: `normalizarPacientes` (el motivo llega hasta lo que se guarda) y el alta con dos progenitores. Ninguna otra toca `patients`: `_smoke-borrar-paciente.mjs` y `_smoke-paciente-borrado.mjs` son de `clients` (la «paciente» de una consulta de nutrición es un `Client`). |
| **Decisiones** | `../decisions/2026-08-28-buscar-por-nombre-y-apellidos.md` · `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` · `../decisions/2026-08-01-alta-de-clientes-por-perfil.md` · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` |
| **En este doc** | Decisión arquitectónica: `patients` ≠ `clients` · Estado: Fase 1 (backend real) · Modelo · Frontend · Migración · Decisiones cerradas |

> Documentación de detalle. Referencia rápida en `CLAUDE.md`. Si
> encuentras una discrepancia con el código, **prevalece el código**:
> actualiza este fichero.


## El buscador: nombre y apellidos

El nombre de un paciente está partido en `first_name` y `last_name`, y el
buscador de `/pacientes` **parte lo escrito en palabras y las exige todas**,
cada una en cualquiera de las dos columnas (`lib/utils/busqueda.js`). Así
«hugo castro» encuentra a «Hugo Castro Díaz» —cosa que antes no hacía **para
ninguno de los 1.174 pacientes de Aumenta**—, y también «castro hugo», «hugo
díaz» y «hugo castro diaz» sin tilde.

Dos cosas que conviene saber antes de tocarlo:

- Las columnas se pasan **con el alias del modelo por delante**
  (`"Patient.first_name"`), porque la condición se monta con `col()` y la
  consulta lleva un `include`: una columna suelta puede salir ambigua.
- La cláusula va a **`Op.and`**, nunca a `where[Op.or]`: el filtro por
  terapeuta ya usa `Op.and`, y dos `Op.or` en el mismo objeto se pisan en
  silencio.

El filtrado lo hace el SERVIDOR (la caja manda `?q=` con 300 ms de espera), y
por eso el mensaje del listado vacío se decide por si hay algún filtro puesto
y no por `patients.length`: con el filtrado en el servidor, eso es 0 en cuanto
una búsqueda no encuentra nada, y la pantalla contestaba «Aún no hay
pacientes» a un centro con 1.174.

Historia y números: `../decisions/2026-08-28-buscar-por-nombre-y-apellidos.md`.
## Visión general

Módulo de gestión de pacientes pediátricos para un centro de
psicopedagogía. Maneja la ficha clínica (centro escolar, curso
académico, motivo de derivación, terapeuta principal, frecuencia,
estado del tratamiento, especialidades, consentimientos, datos
personales y parentesco con quien paga) y el timeline de sesiones /
informes / coordinaciones de cada paciente.

**Histórico (hasta 06/2026):** nació como **sprint visual** complementario al
módulo [Clínica](clinica.md) para la demo del **9 de junio de 2026** con el
equipo de Aumenta; hoy es backend real (ver «Estado: Fase 1»).

Se activa con `scripts/enable-module.js <slug> pacientes` (requiere `clients`;
`clinica` lo arrastra). Quién lo tiene NO se lista aquí: `/admin/modulos` o
`scripts/inspect-tenant-modules.js <slug>`. A 19/08/2026 está encendido en
`aumenta` (la reina), `demo`, `demo_clinica` y `somos` — siempre junto a
`clinica`: ningún tenant tiene `pacientes` suelto.

## Decisión arquitectónica: `patients` ≠ `clients`

Aumenta tiene activos los módulos `clients` y `pacientes`
simultáneamente. **Son tablas separadas**, y desde el 16/07/2026 **enlazadas**:

- `clients` (tabla `clients`, modelo `Client`): la **familia que paga** (el
  tutor). En Aumenta son 1.083 fichas: contratos, tutores, contactos,
  facturación y portal cuelgan de aquí.
- `patients` (tabla `patients`, modelo `Patient`): paciente clínico
  con campos pediátricos (centro escolar, motivo derivación,
  terapeuta principal, frecuencia de asistencia, estado del
  tratamiento). En Aumenta, 1.174 hijos de esas familias.

**Las FKs del módulo Clínica apuntan a `patients`**:

- `clinic_sessions.patient_id` → `patients.id` (NOT NULL, RESTRICT).
- `coordinations.related_patient_id` → `patients.id` (nullable, SET NULL).
- `clinical_reports.patient_id` → `patients.id` (NOT NULL, RESTRICT).

**Y el paciente apunta a su pagador**: `patients.client_id` → `clients.id`
(nullable, ON DELETE SET NULL, `migrate-client-module-assignments.js`;
`relationship` dice el parentesco y `dni`/`address`/`consents` llegaron con
`migrate-patients-clients-phase1.js`). Llegó con el sprint «Clientes ↔ módulos»
(16/07/2026) y el sprint «conexión cliente/equipo» del 23/07
(`../decisions/2026-07-23-conexion-cliente-equipo.md`) lo remató con el
`client_id` de las tablas clínicas y el backfill. De él cuelgan: los
pacientes vistos desde la ficha de la familia
(`components/clients/ClientPatientsSection.jsx`, varios por cliente,
`migrate-patients-multi-per-client.js`), el alta de la familia que crea a sus
pacientes en la misma transacción (`components/clients/PacientesDelAlta.jsx`,
`lib/clients/formularioAlta.js`), la casilla «Paciente Clínica» de la ficha
(`lib/clients/moduleAssignments.js` → `syncClinicPatient`), y el `client_id`
que las sesiones, informes y coordinaciones copian del paciente al crearse.
Para el histórico sin enlace: `scripts/backfill-patients-client.js` (deduce el
pagador de las citas/sesiones del propio paciente; si hay dos candidatos
—padres separados— lo lista en vez de adivinar; nunca cruza por nombre).

**Histórico (06/2026):** `_hechos/migrate-pacientes-sprint-1.js` hizo la migración
correctiva tras el sprint Clínica en `crm_aumenta`: dropeó las columnas
`client_id` originales de las tres tablas clínicas y añadió las `patient_id`.

### Por qué dos tablas y no una

Decisión tomada con Jorge el **8 de junio de 2026**: mantener
separados los conceptos comercial (cliente) y clínico (paciente)
hasta que un sprint futuro evalúe si conviene fusionarlos. Con el uso
real de Aumenta la razón se afinó: el paciente NO es quien paga (el cliente
es el tutor, y dos hermanos comparten familia y contrato), así que las dos
tablas se quedan y lo que hacía falta era el enlace de arriba, no la fusión.
Donde el paciente SÍ es quien paga (la consulta de nutrición de Laura) no hay
`patients`: el `Client` se rotula «Paciente» (`lib/clients/vocabulario.js`).

## Estado: Fase 1 (backend real)

`/pacientes` (listado) y `/pacientes/[id]` (ficha) leen y escriben datos reales vía
`/api/pacientes/*` (11 `route.js`) y `/api/clinica/*`: listar paginado con
filtros (nombre, terapeuta, estado, `careType`, `specialty`, `clientId`) y
resumen por estado sobre TODO el filtro, ficha con pestañas, crear paciente
(con especialidades), editar ficha (auditado como `pacientes.updated`), crear
informe y marcar sesión publicada. La tabla `patients` ya **no** es
aumenta-only: la migración `scripts/migrate-clinica-module.js` la crea en
cualquier tenant con `clinica` o `pacientes` (lee `master.tenants`), y desde el
19/08/2026 está en el bloque `pacientes` de `scripts/_module-migrations.js`
además de en el de `clinica`, así que `enable-module.js <slug> pacientes` crea
la tabla antes de correr las seis ALTER que la necesitan.

**Fase 3 (real):** `/pacientes/[id]/sesiones/nueva` sube el audio → Whisper (OpenAI)
transcribe → Claude estructura → la terapeuta revisa/edita → se guarda como
`ClinicSession`. (Modo demo *canned* en local sin claves.)

> El resto del documento (Sprint 1, dummy `p-1`, etc.) es histórico; la ficha ya no
> depende de `isDiego` y todos los pacientes muestran sus datos reales.

## Lo que NO hace (Sprint 1)

> **Histórico (hasta 06/2026):** punto de partida de la maqueta. Hoy hay CRUD
> (salvo borrar: `/api/pacientes/[id]` tiene GET y PATCH, no DELETE), persistencia,
> IA real y búsqueda/filtros del servidor. Lo que llega a la familia es el informe
> en su área privada («Enviar al paciente», sin correo); no hay avisos al colegio
> ni filtro por terapeuta logueado (todos ven todos).

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

## Un paciente puede tener varios terapeutas (25/08/2026)

Lo pidió Lau (Aumenta, 14/08/2026): «en los pacientes que tienen dos terapias,
cómo meter a los 2 terapeutas que tiene, porque me sale la opción solo para
seleccionar 1 y lo llama terapeuta principal». No era hipotético: medido en
producción, **15 pacientes de Aumenta ya tienen citas repartidas entre dos o
tres profesionales** (máximo 3), y la ficha obligaba a elegir cuál «contaba».

**El modelo, en tres frases:**

1. `patient_therapists` es la lista COMPLETA (el de referencia incluido), una
   fila por persona, con su `specialty` —Lau no pidió dos nombres: pidió los dos
   de un paciente con DOS TERAPIAS, y sin decir cuál da cada una la lista no
   contesta a lo que preguntó.
2. `patients.main_therapist_id` **se queda** y dice cuál de ellos es el de
   referencia: quién firma por defecto y por quién se reparte el cumplimiento
   del plan. Es el mismo patrón que `lib/clients/contactMethods.js` con los
   contactos múltiples de un cliente.
3. Si un paciente NO tiene filas, manda la columna sola.

La tercera es la importante: **por eso esto se desplegó sin tocar un solo
dato.** Los pacientes que ya tenían terapeuta lo siguen enseñando, y su fila
aparece la primera vez que alguien edita la ficha. `backfill-patients-terapeutas.js`
existe para uniformarlo, pero es opcional: el código funciona sin correrlo.

Y la consecuencia buscada: **`lib/clients/urgentes.js` no se toca**.
«Pacientes sin terapeuta» sigue siendo `main_therapist_id IS NULL` y sigue
queriendo decir exactamente eso, porque el escritor mantiene el invariante —el
espejo es el primero de la lista, y null si y solo si la lista queda vacía—.

**Sin asociaciones de Sequelize, a propósito.** El repo tiene el mismo patrón en
`lib/clinica/incidencias.js` y allí sí usa `belongsToMany` + `setAssignees()`.
Aquí no, por dos motivos: `set()` borra y recrea TODAS las filas en cada
guardado, y las nuestras llevan datos propios (`specialty`, `assigned_at`) que
se perderían en silencio; y un include hacia una tabla de muchos a muchos en el
listado paginado hace que `findAndCountAll` cuente filas del JOIN en vez de
pacientes. Se lee con dos consultas planas, como las sesiones.

⚠️ **Esto NO es un permiso.** Que alguien no esté en la lista de un paciente no
le impide ver su ficha: `/api/pacientes` no tiene reglas de visibilidad y esto
no las añade. Si algún día se quiere que las tenga, va donde van esas, con su
prueba (el precedente y el fallo que costó, en `lib/citas/visibilidad.js`).

**Dónde**: `lib/clinica/terapeutas.js` (la regla), `models/tenant/PatientTherapist.model.js`,
`components/clinica/TerapeutasPicker.jsx` (la pantalla) y
`scripts/_smoke-clinica-terapeutas.mjs` (29 comprobaciones).

**El alta sigue con un solo desplegable** y es deliberado: crea al paciente con
su terapeuta de referencia, y el segundo se añade desde la ficha. El rótulo de
la cabecera cambia solo — «Terapeuta» con uno, «Terapeutas» con varios—, que es
lo que Lau preguntaba al decir si «principal» se podía cambiar.

⚠️ Una trampa que costó una tarde y que aplica a CUALQUIER consulta cruda del
repo: el `searchPath` que se le pasa a Sequelize (`lib/db/sequalize.js`) **no
llega a `sequelize.query()`**. Los modelos cualifican el schema porque lo llevan
dentro; una consulta cruda sale con el `search_path` de la conexión, que apunta
a `public`. La sonda `to_regclass('patient_therapists')` devolvía null en todos
los tenants, la tabla parecía no existir nunca y todo caía al espejo en
silencio. Va cualificada: `to_regclass('"crm_x"."patient_therapists"')`.

## Modelo

### Patient

Fichero: `models/tenant/Patient.model.js`. Tabla: `patients`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID nullable | `client_id`: FK a `clients` (ON DELETE SET NULL), el pagador/tutor. Nullable: los pacientes del flujo histórico de Aumenta nacieron sin él (ver `backfill-patients-client.js`). |
| `careType` | VARCHAR(20) NOT NULL | `terapia` (default) o `nutricion`: módulo asistencial del paciente, derivado de `specialties`. Permite que un centro con los dos servicios (la demo) clasifique a cada persona. |
| `specialties` | JSONB NOT NULL DEFAULT `[]` | Especialidades clínicas (taxonomía en `lib/clinica/specialties.js`, compartida con Equipo); un paciente puede tener varias. |
| `firstName` | VARCHAR(120) NOT NULL | Nombre del paciente. |
| `lastName` | VARCHAR(120) NOT NULL | Apellidos. |
| `birthDate` | DATEONLY nullable | Fecha de nacimiento. |
| `age` | INTEGER nullable | Edad escrita a mano (0-120). Desde el 03/09/2026 (AV-0034) es el RESPALDO: la ficha, el listado y los informes enseñan `edad`, que el serializador calcula desde `birthDate` con `lib/clinica/edad.js` y solo cae a `age` si no hay fecha. Los dos formularios (alta y editar) piden la fecha; la casilla «Edad» queda para quien no la sabe. |
| `educationCenter` | VARCHAR(200) nullable | Centro escolar (ej. "CEIP Las Acacias"). |
| `educationLevel` | VARCHAR(80) nullable | Curso académico (ej. "3º Primaria"). |
| `referralReason` | TEXT nullable | Motivo de derivación. |
| `referredBy` | VARCHAR(120) nullable | Quién derivó al paciente (orientador, pediatra, familia, etc.). |
| `objectives` | JSONB NOT NULL DEFAULT `[]` | Objetivos terapéuticos del paciente (tags cortos). Distintos de los de cada sesión y de los del plan de intervención: las tres listas no se copian entre sí. |
| `mainTherapistId` | UUID nullable | FK a `team_members` (ON DELETE SET NULL). |
| `enrollmentDate` | DATEONLY nullable | Fecha de alta en el centro. |
| `attendanceFrequency` | VARCHAR(50) nullable | Frecuencia ("Semanal", "Quincenal"). |
| `status` | ENUM NOT NULL | `active`, `paused`, `discharged`. Default `active`. |
| `dischargeDate` | DATEONLY nullable | Fecha de alta médica (cuando aplica). |
| `dischargeReason` | TEXT nullable | Motivo del alta. |
| `notes` | TEXT nullable | Notas internas. |
| `dni` | VARCHAR(20) nullable | Datos personales (sprint Pacientes & Clientes, `migrate-patients-clients-phase1.js`). |
| `address` | VARCHAR(255) nullable | Domicilio. |
| `relationship` | VARCHAR(60) nullable | Parentesco con el cliente que paga (hijo/a · tutor legal · cónyuge · el propio cliente · hermano/a; texto libre para «otro»). |
| `consents` | JSONB NOT NULL DEFAULT `{}` | Consentimientos RGPD con traza legal: `{ images, marketing, whatsapp }`, cada uno `{ granted, at, by }` (`lib/clinica/consents.js`). |
| `contractSigned`, `contractFile` | BOOLEAN / JSONB | **Legado** (ver nota de abajo). |

Índices: `(last_name, first_name)`, `(main_therapist_id)`, `(status)`,
`(client_id)` (no único: un cliente puede tener varios pacientes,
`migrate-patients-multi-per-client.js`).

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
sub-ítem del grupo **Clínica** (sección «Salud»). Ver
[`docs/modules/clinica.md`](clinica.md) → Sidebar. Las rutas siguen siendo
`/pacientes*` (no cambian).

Tres páginas en `app/(dashboard)/pacientes/`, todas `"use client"` y sobre
datos reales.

| Ruta | Propósito |
| --- | --- |
| `/pacientes` | Listado paginado (`GET /api/pacientes`, 300 por página). 4 KPIs: los tres de estado salen del **resumen del servidor sobre todo el filtro** (no de la página cargada); «Sesiones registradas» suma solo la página. Filtros: búsqueda por nombre (con retardo), terapeuta, estado. Tabla con avatar + nombre + centro + motivo + terapeuta + última sesión + estado + «Ver ficha». Alta en modal con `SpecialtyPicker`. |
| `/pacientes/[id]` | Ficha. Cabecera con avatar, nombre + chip de estado, datos clave (centro, terapeuta, fecha alta, frecuencia), 3 botones («Subir audio», «Nuevo informe», «Editar ficha»). 6 pestañas: Resumen, Plan, Sesiones, Informes, Coordinaciones, Documentos (detalle abajo). |
| `/pacientes/[id]/sesiones/nueva` | Flujo REAL de subida de audio con 4 estados: sube → `POST /api/clinica/sessions/transcribe` → revisar/editar → `POST /api/clinica/sessions` (+ adjuntos de preparación a `prep-files`). Máx. 25 MB; m4a/mp3/wav/ogg/webm. |

### Dos cosas que se rompieron en silencio y se arreglaron el 26/08/2026 (Lau, Aumenta)

#### «Nuevo informe» tumbaba la ficha entera

«Dentro del paciente, cuando le doy arriba a la derecha a nuevo informe sale
THIS PAGE COULDN'T LOAD.» Literal: el cartel de fábrica de Next, con la ficha
perdida y hay que volver a entrar.

El 31/07/2026 el formulario del informe pasó de dos campos a cuatro (se añadió
elegir en qué sesiones se basa el evolutivo, `sourceSessionIds`). El estado
inicial se actualizó; los **dos sitios que lo REINICIAN** —el botón de la
cabecera y el «después de crear»— se quedaron con la copia vieja de dos. Al
abrir el modal, React leía `reportForm.sourceSessionIds.length` sobre un
`undefined` y reventaba **en mitad del pintado**; como no hay ningún `error.jsx`
en toda la aplicación, el golpe sube a la raíz y Next tapa la página.

**Estuvo roto 26 días, desplegado.** En ese tiempo Aumenta creó **0 informes
clínicos** con 22.045 sesiones registradas y 695 coordinaciones: nadie consiguió
abrir el modal nunca, y la función que se añadió aquel día no llegó a usarse ni
una vez. El camino de `/clinica/informes` sí funcionaba (usa `EMPTY_FORM`, una
sola copia), pero ahí hay que buscar al paciente en una lista y no deja marcar
sesiones.

Ahora el formulario vacío sale de **una sola función**, `informeVacio()`, y
cambiar un campo va por updater (`setReportForm((f) => ({ ...f, … }))`) en vez
de por objeto a mano. Lo vigila `scripts/_smoke-informe-formulario.mjs`, cuya
aserción principal no es «existe la constante» sino la invariante:
**todo campo que la pantalla LEE de `reportForm` tiene que existir en el
formulario vacío**. Así caza también el quinto campo de mañana.

#### El filtro «Terapeuta» enseñaba media plantilla, y cambiaba al paginar

«En el filtro de terapeutas, a las cuentas que no son de admin no les aparecen
todas las terapeutas.»

La pantalla pide `GET /api/team?status=active&limit=200` y **se traga el 403 en
silencio** (`r.ok ? r.json() : null`). Entonces entra el plan B —derivar la
lista de los pacientes que tenga cargados— que solo ve **los 50 de la página
actual, de 1.174**, y solo su terapeuta de referencia. De ahí que salieran pocas
y que la lista **cambiara al pasar de página**.

El 403 venía de que las 15 cuentas de rol `user` de Aumenta no llevan `team` en
su `moduleAccess`. Se arregló en el endpoint, no aquí: `GET /api/team` gatea
ahora por el CENTRO y sirve la **lista recortada** a quien no tenga el módulo en
sus accesos (`docs/modules/team.md`).

⚠️ **No era solo un filtro.** Ese mismo desplegable es el que asigna terapeuta
en el alta de paciente (el modal de «Crear paciente»), así que quien no fuera
dirección solo podía elegir entre los que le salieran: o dejaba el paciente sin
terapeuta o le ponía a quien tuviera a mano. El agujero no solo escondía,
**ensuciaba el dato** — y el terapeuta de referencia es lo que cuadra la agenda
y las estadísticas del centro.

El plan B se queda donde está: sigue haciendo falta para un tenant que tenga
`pacientes` y NO tenga `team`, donde el 403 es correcto.
### Particularidades del listado

**Histórico (hasta 06/2026):** los KPIs se derivaban del array `PATIENTS` de
`dummyData.js` (fichero borrado el 20/08/2026). Hoy los tres de estado vienen
de `resumen` (`GET
/api/pacientes` agrega por `status` sobre todos los pacientes que cumplen el
filtro, no solo la página: sin eso, al paginar el centro «tenía 50 activos»), y
el total es el de verdad desde la paginación del 02/08/2026 (antes pedía 300
fijos y devolvía el tamaño de la página como total, así que Aumenta, con 1.174,
veía «300»).

### Ficha del paciente

Cabecera fija con avatar circular (color por paciente), nombre + chip
de estado, datos clave (centro, terapeuta, fecha alta, frecuencia), 3
botones laterales.

Pestañas (`TABS` en `app/(dashboard)/pacientes/[id]/page.jsx`):

1. **Resumen**: motivo de derivación, objetivos terapéuticos (los de la
   ficha; hay tres listas de objetivos —ficha, plan, sesión— y no se copian
   entre sí), citas del paciente (solo las que lo tienen asignado), **contacto
   (pagador)** con sus métodos de contacto y el aviso «padres separados»,
   **datos y consentimientos** (DNI, parentesco, domicilio; chips Imágenes /
   Publicidad / WhatsApp), el contrato de la FAMILIA (se gestiona en la ficha
   del cliente; aquí solo se consulta y enlaza) y **facturación**
   (`PatientBillingSection`).
2. **Plan**: plan de intervención (`InterventionPlanSection`, `PUT
   /api/pacientes/[id]/plan`, auditado).
3. **Sesiones**: lista. Click en una sesión abre un drawer con el registro en
   3 partes (preparación + adjuntos, informe, devolución de la familia).
   Respeta la regla #13 (`top-14 lg:top-0`).
4. **Informes**: listado de informes (evolutivo / entrevista inicial / alta /
   derivación); enlaza a `/clinica/informes`.
5. **Coordinaciones**: primero la agenda de **contactos externos** del paciente
   (`PatientExternalContactsSection`, `/api/pacientes/[id]/contactos/**`), luego
   las actas, con alta (`NuevaCoordinacionModal`).
6. **Documentos**: adjuntos del paciente (`PatientDocumentsSection`,
   `/api/pacientes/[id]/documents/**`).

**Histórico (hasta 06/2026):** en la maqueta solo Diego Martín (`id="p-1"`)
tenía datos completos y los otros 5 pacientes eran placeholders con empty
states; la ficha tenía 4 pestañas. Hoy todos muestran sus datos reales.

### Flujo de subida de audio

La pantalla `/pacientes/[id]/sesiones/nueva` es el "wow moment" de la
demo. Cuatro estados manejados con `useState`:

1. **`IDLE`**: zona drag-and-drop con icono cloud-upload. Texto:
   "Sube el audio grabado con tu móvil. La IA lo transcribirá y
   estructurará en apartados." Formatos admitidos m4a/mp3/wav/ogg/webm, máx.
   25 MB. Click o drop → estado `UPLOADED`.
2. **`UPLOADED`**: muestra el archivo elegido con player + botones "Cambiar
   archivo" / "Procesar con IA". Click en "Procesar" → estado `PROCESSING`.
3. **`PROCESSING`**: `POST /api/clinica/sessions/transcribe` (multipart) con
   spinner + lista animada de 5 pasos mientras responde:
   - Subiendo audio…
   - Transcribiendo con Whisper…
   - Identificando objetivos trabajados…
   - Estructurando observaciones…
   - Listo.
   Con respuesta → `STRUCTURED`; con error, vuelve a `UPLOADED`.
4. **`STRUCTURED`**: 2 columnas. Izquierda: audio + transcripción literal.
   Derecha: bloque estructurado EDITABLE con objetivos chips + actividades +
   desempeño + observaciones sub-divididas (familia / próxima / casa /
   incidencias), más preparación y devolución de la familia. Footer con
   Cancelar / **Guardar sesión** → `POST /api/clinica/sessions` (el endpoint de
   transcripción NO guarda nada: la terapeuta confirma).

**Histórico (hasta 06/2026):** en la maqueta el archivo era fake
(`sesion-diego-5jun.m4a · 0:47 · 1.2 MB`), el procesado un temporizador de ~3
segundos y la transcripción el texto del documento original de Aumenta.

**El CRM no graba sesiones**. La grabación se hace en el móvil de la
terapeuta con cualquier app de notas de voz. El CRM solo recibe el
archivo y lo procesa. Esto fue una decisión explícita: simplificar
el ámbito del producto y delegar la grabación al dispositivo.

## Migración

Hoy no se lanza nada a mano: `scripts/enable-module.js <slug> pacientes`
corre, vía `ensure-tenant-schema.js`, las **siete** del bloque `pacientes` de
`scripts/_module-migrations.js`: `migrate-clinica-module` (crea `patients` y
su enum; está en este bloque desde el 19/08/2026, antes solo en el de `clinica`
y activar `pacientes` suelto corría las seis ALTER sobre una tabla inexistente),
`migrate-patients-clients-phase1` (dni, address, relationship, consents,
contrato legado), `migrate-client-module-assignments` (`client_id` + FK),
`migrate-patients-multi-per-client` (quita el índice único 1:1),
`migrate-patients-care-type`, `migrate-patients-specialties`,
`migrate-documents-patient-link`. Todas leen `master.tenants` (regla #12) y
son idempotentes. El analizador de orden deduplica las que también están en el
bloque `clinica`.

**Histórico (hasta 06/2026):** `scripts/_hechos/migrate-pacientes-sprint-1.js`. Solo
schema `crm_aumenta` (hardcoded). Idempotente. ONE_OFF en
`_module-migrations.js`, ya ejecutado: **no usarlo** (los npm
`db:migrate:pacientes(:prod)` siguen apuntando a él).

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
`_hechos/migrate-clinica-sprint-1.js`. Si las tablas de Clínica no existen,
la fase C las salta con mensaje informativo.

## Tenants

Quién tiene el módulo no se lista aquí: `/admin/modulos` o
`scripts/inspect-tenant-modules.js <slug>`. Lo que sí hay que saber: `aumenta`
es la reina (1.174 pacientes reales: NO wipear ni sembrar sin permiso); siempre
va con `clinica` (ningún tenant lo tiene suelto); quien no lo tiene mantiene su
`clients` estándar sin interferencia, y si el cliente ES el paciente
(nutrición sin clínica) lo que cambia es el rótulo de `clients`, no la tabla.

`'pacientes'` **no** está en `ALL_MODULES` (`scripts/db-sync.js`): ese array
solo siembra la demo local. Se activa con `scripts/enable-module.js <slug>
pacientes`, que abre las dos puertas (`tenant_modules` y `users.module_access`).

## Coherencia con sprint Clínica

**Histórico (hasta 06/2026):** los datos dummy de Pacientes estaban
**alineados con los de Clínica** para que la demo del 9 de junio contase una
sola historia: Diego Martín (`p-1`, 8 años, CEIP Las Acacias, 3º Primaria) era
el paciente del informe extenso de `/clinica/informes`, y su terapeuta
principal **Lorena Vázquez** (`t-1`) la protagonista del dashboard
`/equipo/mi-desempeno` con 87/100. La costura que lo mantenía alineado era un
array `THERAPISTS` en `clinica/_components/dummyData.js` que
`pacientes/_components/dummyData.js` re-exportaba, de modo que se tocaban las
terapeutas en un único fichero.

**Los dos ficheros se borraron el 20/08/2026** y con ellos esa instrucción, que
llevaba meses siendo falsa: aquí ya no hay nada que editar. **Hoy las
terapeutas son el equipo de verdad del tenant.** Tanto el listado como la
ficha las piden a `GET /api/team?status=active&limit=200` y pintan el
`displayName` de cada `TeamMember`; lo que se guarda en el paciente es
`mainTherapistId`, una FK a esa persona, no un nombre suelto. Para cambiar las
terapeutas que salen en el filtro y en el desplegable de alta se da de alta o
de baja gente en `/equipo`, y no se toca código.

Dos detalles que conviene saber porque no son obvios leyendo la pantalla:

- **El listado aguanta sin `team`.** Si la llamada no trae nada —el tenant no
  tiene el módulo, o falla— las opciones del filtro se derivan de los propios
  pacientes cargados: se agrupan los `p.therapist` que vengan del servidor. Se
  filtra por quien ya tiene pacientes, que es lo útil, en vez de quedarse con
  un desplegable vacío.
- **La ficha no lo hace.** El desplegable «Terapeuta principal» solo se dibuja
  si la lista de equipo trae a alguien; sin `team` desaparece de la edición
  (por eso `lib/provisioning/dependencias.js` marca `team` como dependencia
  parcial de `pacientes`). El nombre de la terapeuta ya asignada sí se sigue
  viendo, porque viene serializado con el paciente.

## Backlog (Sprint 2+)

> Lista escrita tras el sprint visual. Lo tachado ya está; lo demás sigue
> abierto.

- ~~Endpoints CRUD para `Patient` (POST/PATCH + listado paginado con búsqueda
  real en BD).~~ **HECHO**. Falta DELETE: `/api/pacientes/[id]` tiene GET y
  PATCH; borrar un paciente no existe (las sesiones lo referencian con
  RESTRICT).
- ~~Persistencia real del flujo de subida de audio~~ **HECHO** de forma
  síncrona: `transcribe` devuelve y no guarda; la terapeuta confirma con `POST
  /api/clinica/sessions`. Sin cola ni WebSocket (el audio no se almacena: solo
  viaja a Whisper).
- Adjuntos en informes (`ClinicalReport.attachments`) con subida real
  de PDFs / imágenes. (Los adjuntos que sí existen son los de preparación de la
  sesión, `prep-files`, y los documentos del paciente.)
- Filtros avanzados en el listado: por edad, centro escolar,
  frecuencia, rango de fechas. (La API ya filtra además por `careType`,
  `specialty` y `clientId`; la pantalla solo expone nombre/terapeuta/estado.)
- ~~Vinculación opcional `Patient` ↔ `Client`~~ **HECHO** (`patients.client_id`,
  16/07/2026): ver «Decisión arquitectónica».
- Roles: terapeuta ve solo sus pacientes; dirección ve todos.
- ~~Validaciones del formulario "Editar ficha" (hoy decorativo).~~ **HECHO**
  (`PATCH /api/pacientes/[id]`).
- ~~Auditoría: registrar en `master.AuditLog` cambios de estado.~~ **HECHO**
  en parte: `pacientes.created` / `pacientes.updated` (resumen sin datos de
  salud, `lib/clinica/audit.js`); no hay evento específico por cambio de
  estado.

## Decisiones cerradas

- **Tabla independiente de `clients`** (8 jun 2026), **enlazada por
  `client_id`** desde el 16/07/2026: el paciente no es quien paga.
- **Las FKs de Clínica se mueven de `clients` a `patients`** en la
  migración correctiva. Las tablas estaban vacías → sin pérdida de
  datos.
- **El CRM no graba audio**, solo lo recibe.
- **No se cruza paciente ↔ cliente por nombre** (backfill): un menor bajo la
  familia equivocada sería una fuga de datos clínicos.
- *(Maqueta, 06/2026)* **Un único paciente con datos completos** (Diego
  Martín); los otros 5, placeholders honestos con empty state explícito.
- *(Maqueta, 06/2026)* **KPIs derivados** del array `PATIENTS`, no inventados,
  para evitar incoherencias del tipo "42 activos · 6 visibles". La misma regla
  sigue hoy con datos reales: los KPIs salen del resumen del servidor sobre
  todo el filtro, no de la página cargada.
