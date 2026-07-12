# Módulo Clínica (`clinica`)

> Documentación de detalle. Referencia rápida en `CLAUDE.md`. Si
> encuentras una discrepancia con el código, **prevalece el código**:
> actualiza este fichero.

## Visión general

Módulo de gestión del trabajo clínico de un centro de psicopedagogía:
registro de sesiones con paciente, coordinaciones (familia, colegio,
profesionales externos), informes clínicos (evolutivos, admisión, alta)
y sistema de desempeño + incentivos del equipo de terapeutas.

Implementado **inicialmente como sprint visual** para la demo del
**9 de junio de 2026** con el equipo de Aumenta. Toda la lógica de
backend, IA y endpoints está pendiente; las pantallas funcionan con
datos dummy hardcoded.

Activado **solo en aumenta** vía `master.tenant_modules`
(`moduleKey='clinica'`).

## Estado: Fase 1 (backend real) — registros clínicos

Los **registros clínicos** (sesiones, informes, coordinaciones) y **Pacientes**
tienen backend real: endpoints CRUD + persistencia + KPIs computados. Las páginas
`/clinica` (landing), `/clinica/informes`, `/pacientes` y `/pacientes/[id]` leen y
escriben datos reales (ya no `dummyData.js`).

**Fase 2 (desempeño/incentivos) también real:** `/clinica/mi-desempeno` y
`/clinica/direccion` leen de `/api/clinica/performance/*` (scoring por áreas,
ranking, media de equipo, alertas computadas, aprobación de incentivos con
auditoría). Áreas definidas en `lib/clinica/performanceAreas.js`.

**Fase 3 (audio → IA) real:** `/pacientes/[id]/sesiones/nueva` sube el audio →
`POST /api/clinica/sessions/transcribe` (**Whisper de OpenAI** transcribe + **Claude**
estructura) → la terapeuta revisa/edita → guarda la sesión. Modo demo *canned* en
local sin claves (auto si faltan claves y `NODE_ENV≠production`, o `CLINICA_FAKE_AI=1`;
bloqueado en producción). **Ya no queda ninguna pantalla en maqueta.**

- Endpoints: `/api/pacientes/*` y `/api/clinica/{sessions, sessions/transcribe, reports, coordinations, overview, performance}`.
- Transcripción: `lib/clinica/whisper.js` (API de OpenAI, clave del tenant). Estructura:
  `lib/clinica/structureSession.js` (Claude, reutiliza el proveedor de Outreach).
- Serializers: `lib/clinica/serialize.js` (fila Sequelize → forma de la UI).
- Migración **generalizada** `scripts/migrate-clinica-module.js` (lee `master.tenants`,
  ya no aumenta-only). Seed `scripts/seed-clinica-demo.js`.
- IA / audio / PDF / export siguen pendientes (fases posteriores).

> Las secciones "Lo que NO hace" y "Backlog" de abajo describen el Sprint 1 visual
> original; parte ya está cubierta por Fase 1.

## Lo que NO hace (Sprint 1)

- No hay endpoints CRUD (`/api/clinica/*` no existe).
- No hay dictado de voz ni transcripción automática.
- No hay integración con OpenAI / Whisper.
- No hay generación real de informes.
- No hay cálculo automático del desempeño ni de incentivos.
- No hay auditoría (`master.AuditLog` no recibe eventos).
- No hay envío de informes a familias.
- El dummy data de la landing y el panel de Dirección está hardcoded a
  6 terapeutas + Diego Martín; cambiar el equipo real exige editar
  `dummyData.js`.

## Modelos

Cuatro modelos vacíos en `models/tenant/` registrados en `tenantDb.js`.
**Las FKs apuntan a `patients`, no a `clients`** — ver
[`docs/modules/pacientes.md`](pacientes.md) para el porqué.

### ClinicSession

Tabla: `clinic_sessions`. Registro estructurado de una sesión clínica.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `patientId` | UUID NOT NULL | FK a `patients` (ON DELETE RESTRICT). |
| `therapistId` | UUID NOT NULL | FK a `team_members`. |
| `sessionDate` | TIMESTAMPTZ NOT NULL | Fecha y hora de la sesión. |
| `duration` | INTEGER nullable | Minutos. |
| `objectives` | JSONB NOT NULL DEFAULT `[]` | Array de objetivos trabajados (chips). |
| `activities` | TEXT | Actividades realizadas en la sesión. |
| `performance` | TEXT | Desempeño del paciente. |
| `observations` | JSONB NOT NULL DEFAULT `{}` | `{ familyComments, nextSessionNotes, homeworkTasks, incidents }`. |
| `aiTranscription` | TEXT | Transcripción literal (vacía en Sprint 1). |
| `aiStructured` | JSONB | Resultado IA crudo (vacío en Sprint 1). |
| `status` | ENUM | `draft`, `published`. Default `published`. |

Índices: `(patient_id, session_date)`, `(therapist_id, session_date)`.

### Coordination

Tabla: `coordinations`. Acta de una reunión de coordinación.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `coordinationType` | ENUM | `family`, `school`, `psychiatrist`, `neuropediatrician`, `other_therapist`, `orientator`, `other`. |
| `participants` | JSONB DEFAULT `[]` | Lista de asistentes (nombre + rol). |
| `coordinationDate` | TIMESTAMPTZ NOT NULL | Fecha. |
| `topics` | JSONB DEFAULT `[]` | Temas tratados. |
| `agreements` | JSONB DEFAULT `[]` | Acuerdos alcanzados. |
| `nextActions` | JSONB DEFAULT `[]` | Próximas actuaciones con responsable. |
| `relatedPatientId` | UUID nullable | FK a `patients` (ON DELETE SET NULL). |
| `aiTranscription` | TEXT | Vacío en Sprint 1. |
| `aiActaGenerated` | TEXT | Acta IA (vacía en Sprint 1). |
| `createdById` | UUID NOT NULL | FK a `team_members`. |

### ClinicalReport

Tabla: `clinical_reports`. Informe clínico generado.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `patientId` | UUID NOT NULL | FK a `patients`. |
| `therapistId` | UUID NOT NULL | FK a `team_members`. |
| `reportType` | ENUM | `evolution`, `admission`, `discharge`. Default `evolution`. |
| `reportDate` | DATEONLY NOT NULL | Fecha de redacción. |
| `dueDate` | DATEONLY nullable | Fecha límite de entrega. |
| `deliveredAt` | TIMESTAMPTZ nullable | Marca de entrega real. |
| `aiGenerated` | TEXT | Texto IA crudo (vacío en Sprint 1). |
| `contentSections` | JSONB DEFAULT `{}` | `{ motiveOfIntervention, objectives, evolution, achievements, persistentDifficulties, recommendations, continuityProposal }`. |
| `attachments` | JSONB DEFAULT `[]` | URLs/IDs de adjuntos. |
| `status` | ENUM | `draft`, `reviewed`, `delivered`. Default `draft`. |

### PerformanceMetric

Tabla: `performance_metrics`. Puntuación mensual por terapeuta.

7 áreas (la 5 se omite intencionadamente porque el documento original
de Aumenta saltó la numeración) + 3 complementos.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `therapistId` | UUID NOT NULL | FK a `team_members`. |
| `periodMonth` | INTEGER NOT NULL | 1-12. |
| `periodYear` | INTEGER NOT NULL | 2020-2100. |
| `area1Score`…`area8Score` | INTEGER nullable | 0-100. Sin `area5Score`. |
| `complementOccupation` | INTEGER nullable | % ocupación clínica (0-100). |
| `complementSeniority` | INTEGER nullable | Años de antigüedad. |
| `complementAttendance` | BOOLEAN nullable | Asistencia perfecta. |
| `totalScore` | INTEGER nullable | 0-100. |
| `proposedIncentive` | DECIMAL(8,2) | Calculado por IA. |
| `approvedIncentive` | DECIMAL(8,2) | Tras revisión de dirección. |
| `approvedById` | UUID nullable | FK a `team_members`. |
| `approvedAt` | TIMESTAMPTZ nullable | Marca de aprobación. |

Índice UNIQUE: `(therapist_id, period_year, period_month)`.

## Frontend

Cuatro páginas en `app/(dashboard)/clinica/`. Todas son `"use client"`
con datos hardcoded.

| Ruta | Propósito |
| --- | --- |
| `/clinica` | Landing del módulo. KPIs (sesiones, informes pendientes, coordinaciones, próxima entrega), 3 cards de accesos rápidos, pacientes recientes. H1: "Área clínica". |
| `/clinica/informes` | Listado de informes con filtros decorativos. Click en fila abre **drawer** con el informe completo (Diego Martín, `r-1`) — texto extenso con 7 secciones. Otros informes muestran empty state. |
| `/clinica/mi-desempeno` | Dashboard del terapeuta logueado (Lorena Vázquez, 87/100). Anillo SVG con puntuación total, grid de 7 áreas semáforo, complementos, gráfico histórico 6 meses. |
| `/clinica/direccion` | Panel de dirección. 4 KPIs, ranking de 6 terapeutas con chips semáforo en miniatura, alertas, gráfico SVG de evolución del equipo, propuesta de incentivos por terapeuta. |

Cada página interna tiene mini-link "← Volver a Clínica" arriba del
banner. La landing no lo lleva (es el destino).

### Componentes compartidos

- `_components/PreviewBanner.jsx`: aviso cerrable "Esta es la maqueta
  visual…". **Reutilizado también por el módulo Pacientes**.
- `_components/dummyData.js`: datos hardcoded. Terapeutas, pacientes,
  informes, áreas, ranking del equipo. Cambiar aquí cualquier dato de
  la demo.

### Sidebar

"Clínica" es un **grupo plegable** en la sección "Empresa" (icono heartbeat),
visible si `enabledModules.has('clinica')`. Cuelgan de él, como sub-ítems que se
**auto-expanden** al estar en `/clinica/*` o `/pacientes/*`:

- **Pacientes** (`/pacientes`) — primero, es el dato del área clínica.
- **Informes** (`/clinica/informes`)
- **Mi desempeño** (`/clinica/mi-desempeno`)
- **Dirección** (`/clinica/direccion`)

Ya **no** hay entrada "Pacientes" a nivel raíz: vive dentro de Clínica. Usa el
mismo patrón de submenú que Nutrición (`components/layout/Sidebar.jsx`, campo
`children` del item). El gating del grupo es el módulo `clinica`, que en la
práctica siempre va activado junto a `pacientes` (ambos solo en aumenta).

## Migración

`scripts/migrate-clinica-sprint-1.js`. Solo schema `crm_aumenta`
(hardcoded). Idempotente. Crea los 4 enums y las 4 tablas, registra
el módulo en `master.tenant_modules`.

```bash
npm run db:migrate:clinica         # local
npm run db:migrate:clinica:prod    # VPS (vía docker exec, ver más abajo)
```

**Importante**: tras este sprint, el sprint Pacientes ejecuta una
migración correctiva que **renombra `clinic_sessions.client_id` →
`patient_id`** (y equivalentes en `coordinations`, `clinical_reports`).
Si ves discrepancias entre el modelo y la BD, lo más probable es que
falte ejecutar `migrate-pacientes-sprint-1.js`.

## Ejecución en producción

El script vive en el contenedor de la app, no en el host del VPS
(porque el hostname `db` solo resuelve dentro de la red Docker):

```bash
ssh tu-vps
cd /opt/crm-salamandra
git pull
./deploy.sh                                                          # build + restart contenedores
docker exec -it crm-salamandra-app-1 node scripts/migrate-clinica-sprint-1.js
docker exec -it crm-salamandra-app-1 node scripts/migrate-pacientes-sprint-1.js   # importante: después de clinica
```

## Tenants

| Tenant | Módulo `clinica` | Notas |
| --- | --- | --- |
| `aumenta` | activo | Centro de psicopedagogía infantil. Único tenant con el módulo. |
| Resto (`demo`, `nutri_laura`, `quality_energy`, `spain_enzymes`, `retorika`, `abarcaia`) | inactivo | No aparece en sidebar. |

`'clinica'` **no** está en `ALL_MODULES` (`scripts/db-sync.js`); se
gestiona manualmente vía `tenant_modules`. Si se quisiera ofrecer a
más clientes en el futuro, añadirlo al array global.

## Backlog (Sprint 2+)

- Endpoints CRUD para los 4 modelos.
- Subida y procesamiento de audio (ver módulo Pacientes para el flujo
  acordado: el CRM no graba, recibe archivos del móvil de la terapeuta
  y los pasa por Whisper + OpenAI).
- Generación IA de informes a partir de N `ClinicSession` del
  paciente.
- Generación IA de actas de coordinación.
- Cálculo automático del desempeño mensual a partir de
  `ClinicSession`, `ClinicalReport`, asistencia y coordinaciones.
- Workflow de aprobación de incentivos con auditoría en
  `master.AuditLog`.
- Filtrado de vistas por rol (hoy todas las terapeutas son admin y
  ven el panel de Dirección con el ranking de sus compañeras —
  decisión consciente).
- Descarga PDF de informes con QR / plantilla del centro.

## Decisiones cerradas

- **Solo aumenta**: el módulo es específico de Aumenta hasta que un
  segundo cliente lo necesite. No se contamina `demo` ni otros.
- **Sin cuestionarios** (no aplica aquí, sino al módulo Formación de
  Aumenta — ver `training.md`).
- **Nombres de terapeutas 100% ficticios** (Lorena Vázquez, Patricia
  Mendoza, Cristina Olmedo, Inés Carballo, Daniela Espinosa, Raquel
  Tudela) + dirección (Beatriz Andrade, Mónica Salgado) para evitar
  choques con el equipo real durante la demo.
- **FK de Clínica apunta a `patients`, no `clients`**: ver
  [`docs/modules/pacientes.md`](pacientes.md).
