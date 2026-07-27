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

**Fase 2 (desempeño/incentivos) también real:** `/equipo/mi-desempeno` y
`/equipo/direccion` leen de `/api/clinica/performance/*` (scoring por áreas,
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

## Dónde vive cada pantalla (traslado del 2026-07-27)

Las herramientas de **gestión de equipo** (Desempeño, Dirección, Productividad,
Incidencias y Bandeja de trabajo) ya **no cuelgan de Clínica**: son de gestión
del equipo, no clínicas. Se movieron de `/clinica/*` a **`/equipo/*`** (páginas,
menú, migas "Equipo · X" y enlace "Volver a Equipo"). Las URLs viejas redirigen
de forma permanente (`next.config.mjs`), así que los marcadores del equipo de
Aumenta siguen funcionando.

Lo que NO cambió (es interno, no lo ve el usuario):
- los **endpoints** siguen en `/api/clinica/*`,
- la **lógica** sigue en `lib/clinica/*`,
- el **gating** sigue siendo `moduleKey: "clinica"` — un tenant con `team` pero
  sin `clinica` (p. ej. nutri_laura) NO ve estas pantallas.

En `/clinica` se quedan la landing y **Informes**; Pacientes sigue en `/pacientes`.
Los componentes exclusivos de esas pantallas (`PerformanceEditor`,
`IncentiveTiersEditor`, `IncentiveItemsEditor`, `IncidenciaModal`) se movieron a
`app/(dashboard)/equipo/_components/`.

## Programa de Excelencia (2026-07-24)

Cuatro bloques nuevos del "Programa de Excelencia" de Aumenta. Todo gated por
`clinica`/`pacientes`, así que se propaga a todos los tenants con el módulo
(Aumenta reina + demo). **Sin personas dadas de alta**: la maquinaria está, las
terapeutas y sus horas/roles se cargan aparte.

### 1. Incentivos REALES (antes eran dummy)

- `lib/clinica/incentives.js`: `computeTotalScore` (media ponderada de las áreas
  con los pesos de `performanceAreas.js`), `proposeIncentive` (tramos → €),
  `normalizeTiers`/`tiersFromTenant`.
- **Tramos configurables** por tenant en `tenant.settings.clinica.incentiveTiers`
  (JSONB, sin migración). API `GET/PUT /api/clinica/performance/incentive-tiers`
  (PUT solo admin, invalida caché). Default en `DEFAULT_INCENTIVE_TIERS`.
- La propuesta se deriva **en vivo** de `totalScore` + tramos en los serializers
  (`serializePerformance`/`serializeRankingRow` aceptan `tiers`); el campo
  `proposed_incentive` almacenado pasa a ser caché. `approve`/`approve-all` usan
  la propuesta viva, no el valor guardado.
- **Editor de evaluación**: `POST /api/clinica/performance` (upsert por
  terapeuta+periodo; calcula total y propuesta al guardar). UI:
  `PerformanceEditor.jsx` (áreas + complementos + notas, vista previa en vivo) y
  `IncentiveTiersEditor.jsx`, ambos en `/equipo/direccion`.

### 2. Productividad

- `lib/clinica/productivity.js`: `workingDaysInMonth`, `computeProductivity`
  (% horas directas / disponibles), `occupationFromPct`.
- Horas directas = suma de `duration` de las **citas** (`bookings`
  confirmed/completed) del profesional en el mes. Horas disponibles =
  `team_members.weekly_direct_hours` ÷ 5 × días laborables (nueva columna,
  `migrate-team-weekly-hours.js`, módulo `team`). El "-5h/semana" de ciertos
  roles = un número menor, sin hardcodear a nadie.
- API `GET /api/clinica/productividad` + `PUT /api/clinica/productividad/hours`.
  UI `/equipo/productividad`. Conecta con incentivos: botón "traer ocupación" en
  el editor de evaluación.

### 3. Incidencias

- Modelo `Incidencia` (tabla `incidencias`, `migrate-incidencias-module.js`,
  módulo `clinica`). Categorías + subcategorías, responsable (`assignedToId`),
  estados Pendiente/En proceso/Resuelta, prioridad, comentarios (JSONB), paciente
  y cliente-foto opcionales. Taxonomía/serializer en `lib/clinica/incidencias.js`.
- API `GET/POST /api/clinica/incidencias` + `GET/PATCH/DELETE
  /api/clinica/incidencias/[id]` (crear/comentar/cambiar estado por cualquier
  usuario del módulo; borrar solo admin). UI `/equipo/incidencias` +
  `IncidenciaModal.jsx`. Sin auditoría a master (pueden citar datos clínicos).

### 4. Bandeja de trabajo

- API `GET /api/clinica/bandeja` (resuelve el TeamMember logueado; admin puede ver
  otra con `?therapistId=`). Agrega "lo mío pendiente": informes sin entregar
  (vencidos marcados), incidencias asignadas sin resolver y citas de hoy. UI
  `/equipo/bandeja`.

### 5. Dashboard de Dirección ampliado (punto 6)

- `GET /api/clinica/dashboard`: totales de productividad del mes +
  resumen de incidencias (abiertas/pendientes/en proceso, urgentes = prioridad
  alta abiertas, resueltas del mes, por categoría, y las 5 más recientes).
- La página `/equipo/direccion` añade la sección "Operativa del mes" con esas
  tarjetas + barras por categoría + lista de incidencias recientes.
- La agregación de productividad se factorizó a `lib/clinica/productivityQuery.js`
  (`aggregateTeamProductivity`), compartida por `/productividad` y `/dashboard`.

### 6. Alertas automáticas + campanita (punto 7)

- Modelo `Notification` (antes durmiente) + tabla creada por
  `migrate-notifications-table.js` (**CORE**, todos los schemas crm_*; índice
  único parcial `(user_id, type, entity_id)` para deduplicar).
- `lib/notifications/alerts.js`: `syncClinicaAlerts` recomputa al vuelo las
  alertas del usuario (informe vencido, incidencia asignada Pendiente) y hace
  upsert (crea las que faltan, borra las que ya no aplican, preserva "leído").
  Sin job en background: se sincroniza al consultar la campanita.
- API `GET /api/notifications` (sincroniza + lista + nº sin leer, tolerante a
  fallos) y `POST /api/notifications/read`. Componente `NotificationBell.jsx`
  (flotante abajo-derecha, sondeo cada 60s) montado en `DashboardShell` → visible
  en todo el dashboard.

### 7. Incentivos ESCRITOS a mano (2026-07-24)

- Modelo `IncentiveItem` (tabla `incentive_items`, `migrate-incentive-items.js`,
  módulo `clinica`): concepto concreto ("Cambiar la bombilla del centro") por
  terapeuta y mes, con `valueType` 'fixed' (€) o 'percent' (% del SUELDO MENSUAL
  de la ficha de Equipo). `resolvedAmount` = FOTO del importe al crear/editar
  (si el sueldo cambia después, los items ya escritos no bailan); `salaryBase`
  guarda la base usada. Percent sin sueldo configurado → 422 con aviso.
- API `GET/POST /api/clinica/incentive-items` + `PATCH/DELETE .../[id]`
  (SOLO admin, auditado). El POST garantiza la fila de PerformanceMetric del
  periodo (findOrCreate) para que la persona salga en la propuesta sin evaluar.
- Integración: `serializeRankingRow` acepta `extras` → expone `extrasIncentive`
  y `totalProposed` (tramos + escritos). `approve`/`approve-all` aprueban ese
  TOTAL. UI: sección "Incentivos escritos" en `/equipo/direccion`
  (`IncentiveItemsEditor.jsx`) + columnas Por puntuación / Escritos / Propuesto
  en la tabla de propuesta.

### Pendiente del programa

Editar coordinaciones + "próxima fecha" estructurada, y organización documental
por trimestre. Nota: la productividad del **mes en curso** compara horas directas
acumuladas contra las disponibles del mes COMPLETO (se llena según avanza el mes);
para un mes cerrado es exacta.

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

Las pantallas del área viven en DOS carpetas desde el traslado del 2026-07-27
(ver "Dónde vive cada pantalla" arriba). Todas son `"use client"` y leen datos
REALES de la API (ya no hay datos hardcoded).

**En `app/(dashboard)/clinica/` (2 páginas):**

| Ruta | Propósito |
| --- | --- |
| `/clinica` | Landing del módulo. KPIs (sesiones, informes pendientes, coordinaciones, próxima entrega), accesos rápidos a Pacientes e Informes, pacientes recientes. H1: "Área clínica". |
| `/clinica/informes` | Listado de informes con filtros. Click en fila abre **drawer** con el informe completo. |

**En `app/(dashboard)/equipo/` (5 páginas, gestión de equipo):**

| Ruta | Propósito |
| --- | --- |
| `/equipo/mi-desempeno` | Scorecard del terapeuta logueado: anillo SVG con puntuación total, 7 áreas semáforo, complementos e histórico de 6 meses. |
| `/equipo/direccion` | Panel de dirección: KPIs, ranking del equipo, alertas, evolución, "Operativa del mes" y propuesta de incentivos (tramos + escritos). |
| `/equipo/productividad` | % de horas de intervención directa sobre disponibles, por profesional, y edición de las horas/semana objetivo. |
| `/equipo/incidencias` | Registro y seguimiento de incidencias (categorías, responsable, estados, comentarios). |
| `/equipo/bandeja` | "Lo mío pendiente" por terapeuta: informes sin entregar, incidencias asignadas y citas de hoy. |

Cada página interna lleva un mini-link de vuelta arriba: **"← Volver a Clínica"**
en `/clinica/informes`, y **"← Volver a Equipo"** en las cinco de `/equipo/*`.
Las landings no lo llevan (son el destino).

### Componentes

- `clinica/_components/PreviewBanner.jsx`: **desactivado** (devuelve `null`); se
  conserva por si hiciera falta reactivarlo. Lo siguen importando la landing,
  Informes y el módulo Pacientes; las 5 páginas movidas a `/equipo/*` ya no.
- `clinica/_components/dummyData.js`: resto histórico de la maqueta. Las
  pantallas ya no lo usan.
- `equipo/_components/`: componentes exclusivos de las pantallas de gestión de
  equipo — `PerformanceEditor`, `IncentiveTiersEditor`, `IncentiveItemsEditor`
  e `IncidenciaModal`.

### Sidebar

Las pantallas del área cuelgan de **dos grupos distintos** (`components/layout/Sidebar.jsx`):

**Grupo "Clínica"** (icono heartbeat, gating: módulo `clinica`), se auto-expande
en `/clinica/*` y `/pacientes/*`:

- **Pacientes** (`/pacientes`) — primero, es el dato del área clínica.
- **Informes** (`/clinica/informes`)

**Grupo "Equipo"** (`visibleModules: ["team", "clinica"]`, para que la terapeuta
lo vea aunque no tenga `team`). Sus 5 hijos llevan `moduleKey: "clinica"`, así
que un tenant con `team` pero SIN `clinica` (p. ej. nutri_laura) NO los ve:

- **Desempeño** (`/equipo/mi-desempeno`) — `adminOnly`
- **Dirección** (`/equipo/direccion`) — `adminOnly`
- **Productividad** (`/equipo/productividad`) — `adminOnly`
- **Incidencias** (`/equipo/incidencias`) — todo el equipo
- **Bandeja de trabajo** (`/equipo/bandeja`) — todo el equipo

Ya **no** hay entrada "Pacientes" a nivel raíz: vive dentro de Clínica.

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
- ~~Filtrado de vistas por rol~~ **HECHO (2026-07-24)**: las terapeutas son
  rol `user` con `moduleAccess` [calendar, citas, clinica, pacientes] (admón.
  además billing+documents). "Mi desempeño", "Dirección" y "Productividad" son
  SOLO admin: gates de rol en `/api/clinica/performance/*` (GET incluidos),
  `/api/clinica/productividad` y `/api/clinica/dashboard`, ocultos también en
  Sidebar (`adminOnly`) y en la landing de Clínica. El Sidebar además filtra
  módulos por `user.moduleAccess` (espejo de `hasModule`). Login por NOMBRE DE
  USUARIO (p. ej. `arantxa_aumenta` en `users.email`, creado con
  `validate:false`); el formulario de login acepta email o usuario.
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
