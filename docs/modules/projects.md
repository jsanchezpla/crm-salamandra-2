# Módulo Proyectos & Servicios (#3)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `projects` · requiere — (`lib/provisioning/dependencias.js`: se vende solo; sin `team` los tableros funcionan pero solo el admin edita y no hay miembros ni asignados) |
| **Reina** | — · el doc no declara ninguna |
| **Pantallas** | `/proyectos` → `app/(dashboard)/proyectos/page.jsx` (listado, alta y «crear con IA») · `/proyectos/[id]` → `app/(dashboard)/proyectos/[id]/page.jsx` (pestañas Resumen · Equipo · Fases · Configuración, botón «Abrir tablero», reorganizar con IA; la pestaña Fases es `VistaFases` desde el 01/09/2026) · `/proyectos/[id]/board` → `app/(dashboard)/proyectos/[id]/board/page.jsx` (Kanban \| Lista) |
| **Endpoints** | `app/api/projects/**` — 19 `route.js`: `route.js`, `[id]`, `[id]/phases` (+ `[phaseId]`, `reorder`), `[id]/milestones` (+ `[milestoneId]`), `[id]/columns` (+ `[columnId]`, `reorder`, `[columnId]/reorder-tasks`), `[id]/members` (+ `[memberId]`), `[id]/board`, `[id]/tasks`, IA: `ai/generate`, `ai/create`, `[id]/ai/edit`, `[id]/ai/apply` · `app/api/tasks/[id]/**` — 2 (`route.js`, `move`) · `app/api/project-templates/**` — 2 · gateados por `projects` en otros módulos: `app/api/clients/[id]/projects`, `app/api/team/[id]/projects`, `app/api/leads/[id]/convert-to-project`; `app/api/calendar/tasks` mezcla hitos y tarjetas vía `lib/calendar/projectEvents.js` · Públicos: ninguno |
| **Lógica** | `lib/projects/`: `projectAuth.js` (admin o lead del proyecto) · `serializeProject.js` (oculta presupuesto a quien no es admin/lead) · `serializeTask.js` (`assigneeLinks` → `assignees`) · `generateProjectCode.js` (`PRY-YYYY-NNNN`) · `createDefaultBoardColumns.js` (las 4 columnas) · `taskPriority.js` (enum, etiquetas, orden) · `checklist.js` (normaliza items) · `faseProgreso.js` (01/09/2026: cuánto lleva hecha cada fase, el orden de la vista y el avance del proyecto) · `ai/` (`prompts.js`, `parsePlan.js`, `editOps.js`, `fake.js`: modo demo sin coste) · fuera de la carpeta: `lib/calendar/projectEvents.js` |
| **UI** | `components/projects/` (9, todos importados): `KanbanBoard.jsx`, `BoardColumn.jsx`, `TaskCard.jsx`, `TaskDrawer.jsx`, `ProjectListView.jsx`, `PriorityBadge.jsx`, `StatusBadge.jsx`, `AiProjectModal.jsx`, `AiEditModal.jsx`, `VistaFases.jsx` (01/09/2026) · ya no hay huérfanos: los tres del Sprint 1 (`ClientProjectsSection.jsx`, `EmployeeProjectsSection.jsx`, `ConvertLeadToProjectButton.jsx`) se borraron el 20/08/2026 (ver §4) · no hay `modules/projects/` |
| **Modelos** | `Project` (`projects`), `Phase` (`phases`), `Milestone` (`milestones`), `BoardColumn` (`board_columns`), `Task` (`tasks`), `TaskAssignee` (`task_assignees`), `ProjectMember` (`project_members`), `ProjectTemplate` (`project_templates`); `Lead.convertedProjectId` vive en `leads` |
| **Interruptores y parámetros** | ninguno que lea el código (ni `featureFlags` ni `logicOverrides`); lo que varía es por rol (`lib/projects/projectAuth.js`) y por tener `team` |
| **Pantallas propias** | ninguna (letrero `ui_override` vacío en producción) |
| **Scripts** | activar: `node scripts/enable-module.js <slug> projects` (arrastra `MODULES.projects` de `scripts/_module-migrations.js`: `migrate-projects-sprint-1.js`, `migrate-projects-sprint-2.js`, `migrate-projects-task-priority.js`; atajos `npm run db:migrate:projects-1`, `-2`, `-priority`) · seed: `scripts/seed-projects-demo.js` (`npm run db:seed:projects-demo`, idempotente) · `scripts/_hechos/verify-projects-sprint-2.js` (comprobación post-migración) · `scripts/cleanup-projects-code-indexes.js` (índices `projects_code_key*` duplicados; aborta contra prod) |
| **Pruebas** | `scripts/smoke-test-kanban.mjs` (`npm run smoke:kanban`; 13 pasos HTTP contra `demo`, necesita `npm run dev` y base de datos: entra en `npm run test:todo`, no en `npm test`) · ligera, en `npm test`: `scripts/_smoke-projects-ai-parsePlan-editOps.mjs` (`node:test`, 19/08/2026; importa la lib con el gancho `_abrir-lib-hooks.mjs` porque `lib/utils/errors.js` arrastra `next/server`): lo que devuelven `lib/projects/ai/parsePlan.js` y `editOps.js`, los DOS únicos filtros entre el texto de la IA y el schema del tenant —`normalizePlan` lanza `ValidationError` con el mensaje para el usuario si lo que manda el modelo no es un plan, con los topes (12 fases, 60 tareas, 15 hitos, 15 pasos de checklist, 10 etiquetas), fechas y horas estimadas, asignados y miembros filtrados contra el equipo **sin importar la caja del uuid**; `buildProjectSnapshot` con la forma exacta del prompt (200 tareas); `normalizeOperations` por cada operación (`updateProject`, `createPhase`, `updatePhase`/`deletePhase`, `createTask`, `updateTask`, `deleteTask`, `addMember`/`removeMember`) con qué se descarta en silencio, qué avisando y la etiqueta en español de la vista previa; desde el 19/08 un campo inválido («el lunes que viene», «mañana», una descripción que no es texto) se IGNORA avisando en vez de entrar como `null` y borrar lo que había —solo `null` explícito quita—; desde el 21/08/2026 también **la traducción del `phaseIndex` cuando se descarta una fase** (cada hito sigue en la suya y el que apuntaba a la descartada se queda sin fase), **que el mismo uuid en mayúsculas casa con el equipo y lo que se guarda es el id de la base** (y dos veces en distinta caja cuenta como una sola persona), y **que a un miembro que causó baja en el equipo SÍ se le puede quitar del proyecto**; el plan y la propuesta del modo demo (`fake.js`) pasan sin perder nada ni un aviso—. `loadProjectSnapshot` lee de la base y no se prueba · `scripts/_smoke-fases-progreso.mjs` (01/09/2026) fija el cálculo de la vista de Fases: el porcentaje de cada fase (tareas + entregables, con el mismo peso), qué cuenta como retraso, los cinco órdenes de la lista y que el avance del proyecto SUME unidades en vez de promediar porcentajes · desde el 01/09/2026, `scripts/_smoke-ia-respuesta.mjs` cubre lo que rodea a esa frontera: la traducción del error de Anthropic (`lib/ai/errorLegible.js`), el rescate del JSON envuelto (`extraerJson`) y que la respuesta con latido siga siendo JSON parseable con el fallo dentro del cuerpo |
| **Decisiones** | — (ninguna propia; la transversal `../decisions/2026-07-28-repaso-de-seguridad.md` aplica como a todos) |
| **En este doc** | 3. Arquitectura BD · 4. Rutas frontend · 5. Endpoints REST · 6. Helpers / libs · 7. Decisiones arquitectónicas · 8. Migraciones y seeds · 11. Backlog técnico |

> Estado: **Sprint 1 y Sprint 2 (Kanban) desplegados en producción**, y después
> la Vista de Lista con prioridad (12/07/2026), el calendario (27/07/2026) y la
> IA de Proyectos (31/07/2026, con el `/ai/apply` que faltaba el 12/08). En
> producción lo tienen cinco clientes (foto del 19/08/2026: `aumenta`, `demo`,
> `demo_agencia`, `salamandra_solutions`, `somos`); quién lo tiene se mira en
> `/admin/modulos`, no aquí.
> Documentación generada al cierre del Sprint 2 (Kanban funcional + endpoints
> Task + fixes preexistentes) y retocada después.

---

## 1. Resumen ejecutivo

El módulo Proyectos permite gestionar un portafolio de proyectos por tenant
con sus fases, hitos, columnas Kanban, miembros del equipo, plantillas y, a
partir del Sprint 2, **tareas (Task) con tablero drag-and-drop**.

Integraciones internas:

- **Leads** → conversión `lead → project` (Sprint 1):
  `POST /api/leads/[id]/convert-to-project` existe y responde, pero **hoy no
  hay ningún botón que lo llame**: el que se dibujó en el Sprint 1 se borró el
  20/08/2026 sin haber llegado a cablearse (ver §4).
- **Clientes** → `GET /api/clients/[id]/projects` existe, pero **la ficha de
  cliente no lo pinta**: la sección que iba a hacerlo corrió la misma suerte
  (ver §4).
- **Equipo** → asignación de TeamMembers como `lead`/`member`/`viewer` y
  asignación N-a-N de tareas individuales; `GET /api/team/[id]/projects`.
- **Calendario** (27/07/2026) → `lib/calendar/projectEvents.js` mezcla en el
  feed `/api/calendar/tasks` los `dueDate` de las tarjetas y los hitos como
  eventos de solo lectura visual (clic → enlace al proyecto; arrastrar → PATCH
  del `dueDate` real). Solo si el tenant tiene `projects`; nunca tumba el
  calendario si falla.
- **IA** (31/07/2026) → crear un proyecto entero desde un texto y reorganizar
  uno existente (ver §5.5).
- **Costes / Facturas** → FK durmiente `project_id` declarada (Sprint 1),
  sin lógica activa hasta Sprint 4.

---

## 2. Activación del módulo

Por defecto **inactivo**. Se activa por tenant en `master.tenant_modules`
(`moduleKey = "projects"`, `enabled = true`), y la vía es el script, no un
INSERT a mano:

```bash
node --env-file=.env.local scripts/enable-module.js <slug> projects
# VPS: docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> projects
```

Abre las DOS puertas (la fila en `tenant_modules` y `"projects"` en el
`module_access` de los admin; `--grant-users` para el resto) y arrastra las
tres migraciones de `MODULES.projects` en `scripts/_module-migrations.js`, que
es lo que un INSERT a secas se dejaba atrás (incidente del 2026-07-21). Después,
`npm run db:check-access` para comprobar que lo ven. Quién lo tiene hoy: en
`/admin/modulos`, no aquí (una lista a mano se queda vieja).

El seed `seed-projects-demo.js` activa el módulo en `demo` automáticamente
(idempotente).

> Recuerda: `hasModule("projects")` cruza tenant + `User.moduleAccess` desde
> commit `09678fc`. Cualquier usuario del tenant que vaya a usar Projects
> necesita `"projects"` en su `moduleAccess` o ser `superadmin`/wildcard.

---

## 3. Arquitectura BD

### 3.1 Tablas del módulo

| Tabla                 | Sprint | Notas                                                                  |
|-----------------------|--------|------------------------------------------------------------------------|
| `projects`            | 1      | + UNIQUE PARCIAL `projects_code_unique WHERE code IS NOT NULL`         |
| `phases`              | 1      | FK ON DELETE CASCADE. UNIQUE `(project_id, order)`                     |
| `milestones`          | 1      | FK project CASCADE, phase SET NULL                                     |
| `board_columns`       | 1      | UNIQUE `(project_id, order)`. `isDoneColumn` único por proyecto en API |
| `tasks`               | 1+2    | Sprint 1 creó shape; Sprint 2 añade 4 índices + FK a board_columns      |
| `task_assignees`      | **2**  | N-a-N task↔team_members; UNIQUE `(task_id, team_member_id)`            |
| `project_members`     | 1      | UNIQUE `(project_id, team_member_id)`. Roles: lead / member / viewer   |
| `project_templates`   | 1      | Sin FK. JSONB phases/boardColumns/defaultMilestones/defaultTags        |

### 3.2 ENUMs

- `enum_projects_status` — `draft | active | paused | completed | cancelled`
- `enum_projects_priority` — `low | medium | high | urgent`
- `enum_tasks_priority` — `low | medium | high | urgent` (columna `tasks.priority`,
  default `medium`; la añade `migrate-projects-task-priority.js` para la Vista de Lista)
- `enum_milestones_status` — `pending | completed | missed`
- `enum_project_members_role` — `lead | member | viewer`

### 3.3 Diagrama de relaciones

```
Client 1—N Project 1—N Phase 1—N Milestone
                  1—N BoardColumn 1—N Task
                  1—N Task ←M task_assignees N→ TeamMember   (Sprint 2)
                  1—N Task ←(legacy assigneeId) TeamMember   (mantener mientras conviva)
                  1—N ProjectMember ↔ TeamMember
                  1—N Cost (FK durmiente, Sprint 4)
                  1—N Invoice (FK durmiente, Sprint 4)
                  ←N Lead (convertedProjectId)

ProjectTemplate (standalone — JSONB)
```

### 3.4 Índices del Sprint 2

| Índice                              | Tabla    | Cubre                                     |
|-------------------------------------|----------|-------------------------------------------|
| `tasks_project_column_order_idx`    | tasks    | listados Kanban ordenados                 |
| `tasks_assignee_idx` (partial)      | tasks    | "Mis tareas" por team_member              |
| `tasks_phase_idx` (partial)         | tasks    | filtrado por fase                         |
| `tasks_milestone_idx` (partial)     | tasks    | filtrado por hito                         |
| `task_assignees_unique`             | task_assignees | duplicados prohibidos               |
| `task_assignees_team_member_idx`    | task_assignees | "Mis tareas" agregadas              |

### 3.5 FK física Sprint 2

`tasks.board_column_id → board_columns(id) ON DELETE SET NULL`. Antes solo
había asociación Sequelize. Si la migración detecta huérfanos (board_column_id
apuntando a columnas inexistentes) **salta la FK con warning** y exige
limpieza manual antes de reintentar.

---

## 4. Rutas frontend

| URL                          | Estado | Componente principal                       |
|------------------------------|--------|--------------------------------------------|
| `/proyectos`                 | S1     | `app/(dashboard)/proyectos/page.jsx` (listado, alta y «Crear con IA») |
| `/proyectos/[id]`            | S1     | `app/(dashboard)/proyectos/[id]/page.jsx` (4 tabs) |
| `/proyectos/[id]/board`      | **S2** | `app/(dashboard)/proyectos/[id]/board/page.jsx` (Kanban \| Lista) |

### Tabs en `/proyectos/[id]`

Hoy son **cuatro** (`TABS` de la página): **Resumen · Equipo · Fases ·
Configuración**. Lo que el Sprint 1 tenía como pestañas propias se recolocó:

- **Hitos** viven en Resumen (KPI «Hitos» + tarjeta «Próximos hitos»); se
  gestionan desde la API (`/milestones`).
- **Tablero** ya no es pestaña: es el botón «Abrir tablero» de la cabecera,
  que lleva a `/proyectos/[id]/board`. Al lado, «Reorganizar con IA» (solo
  admin o lead) abre `AiEditModal`.
- Configuración incluye `ColumnsManager` (columnas del Kanban, marcar la de
  «hecho» con `isDoneColumn`) y el archivado (solo admin).

### Componentes Sprint 2 (`components/projects/`)

- `KanbanBoard.jsx` — wrapper DndContext + filtros + fetch /board + drawer.
- `BoardColumn.jsx` — columna Kanban con SortableContext vertical + WIP count.
- `TaskCard.jsx` — card sortable con title, badge de **prioridad**, dueDate, hours,
  checklist count, avatares de asignados (max 3 + "+N").
- `TaskDrawer.jsx` — drawer derecho ancho 480/600px. Modo view (auto-save por
  blur) y modo create (save explícito). Respeta regla #13 (`top-14 lg:top-0`).
  Incluye selector de **Prioridad** (junto a Columna).
- `ProjectListView.jsx` — **Vista de Lista** (alternativa al Kanban, no lo
  sustituye). Tabla con Tarea / Fecha de entrega / Prioridad / Estado, orden
  **multinivel**: fecha asc (nulls al final) → prioridad mayor→menor → estado
  (orden de columna del Kanban). Lee `/api/projects/[id]/tasks` (todas las
  tareas, incluidas las sin columna) + `/board` (columnas para el drawer).
  Reutiliza `TaskDrawer` al pulsar una fila. Config de orden ajustable en
  `SORT_LEVELS`. Ordenación/etiquetas de prioridad centralizadas en
  `lib/projects/taskPriority.js`.

### Otros componentes (`components/projects/`)

- `StatusBadge.jsx` y `PriorityBadge.jsx` — badges del estado y la prioridad
  del PROYECTO (exportan `STATUS_OPTIONS` / `PRIORITY_OPTIONS`); los usan el
  listado, la ficha y `AiProjectModal`.
- `AiProjectModal.jsx` — drawer «Crear con IA» del listado: texto libre →
  vista previa del plan (fases, tareas, hitos, miembros) editable → confirmar.
- `AiEditModal.jsx` — drawer «Reorganizar con IA» de la ficha: instrucción →
  propuesta de operaciones, cada una desmarcable → aplicar.
  Ver §5.5.

### Toggle Kanban | Lista

En `/proyectos/[id]/board` la cabecera tiene un toggle segmentado **Kanban |
Lista** (`role="tablist"`). Ambas vistas comparten los filtros de la toolbar
(search/asignado/etiqueta) y muestran las mismas tareas. El Kanban queda
exactamente igual que antes.

### Componentes legacy Sprint 1: borrados el 20/08/2026

Durante un año `components/projects/` arrastró tres componentes que **no
importaba nadie**: `ClientProjectsSection.jsx` (proyectos del cliente en su
ficha), `EmployeeProjectsSection.jsx` (proyectos de una persona en `/equipo`)
y `ConvertLeadToProjectButton.jsx` (el botón «convertir lead en proyecto»).
Se dibujaron en el Sprint 1, nunca se cablearon a ninguna pantalla y el doc
los fue anotando cada revisión como «huérfanos, no se borran hasta decidir si
se cablean». El 20/08/2026 se decidió: **se borraron**. Un componente que
lleva un año sin que ninguna página lo importe no es una funcionalidad
pendiente, es código muerto que hay que leer y descartar en cada repaso.

Lo que NO se borró son sus endpoints, que siguen vivos y devolviendo datos:
`GET /api/clients/[id]/projects`, `GET /api/team/[id]/projects` y
`POST /api/leads/[id]/convert-to-project`. O sea que la funcionalidad sigue
estando a un componente de distancia: el día que se quiera de verdad, se
escribe la UI contra el endpoint que ya existe, que es lo barato, en vez de
resucitar un JSX de hace un año contra un `lib/` que ha cambiado por debajo.
Si alguien busca esos nombres dentro de seis meses, esto es lo que pasó.

---

## 4.b Las fases dejan de ser una etiqueta (01/09/2026, Rodrigo)

> «Para que las fases de un proyecto tengan sentido, cuando se pongan en las
> tablas debería haber un desplegable para las distintas Fases. (…) Cada fase
> tiene sus propias tareas y entregables. Debería haber también una vista para
> ver todas las fases en orden de porcentaje de compleción etc y más cosas
> útiles.»

Las fases existían en la base desde el Sprint 1 (`phases`, y `tasks.phase_id` /
`milestones.phase_id`), pero **solo se podían tocar de una en una desde el
drawer** y la pestaña «Fases» era una lista de nombres con dos fechas: decía qué
fases hay y nada de cómo van. Tres cambios, ninguno toca la base:

**1. El desplegable de fase, en las tablas.** La Vista de Lista estrena columna
**Fase** con un `Select` por fila que cambia `phaseId` al vuelo
(`PATCH /api/tasks/[id]`, optimista y con vuelta atrás si el endpoint dice que
no: pide admin o lead). Repartir veinte tareas entre tres fases eran sesenta
clics abriendo y cerrando el drawer; ahora son veinte. La barra del tablero
lleva además un filtro **«Todas las fases»** —con **«— Sin fase —»**, que es un
valor real: las que nadie ha colocado, que es justo lo que hay que colocar— y
vale para las DOS vistas. En el Kanban, cada tarjeta enseña su fase arriba con
su color: una tarjeta suelta no decía de qué parte del proyecto es, y
«Revisión» significa una cosa en Diseño y otra en Entrega.

**2. Cada fase, con sus tareas y sus entregables.** Al abrir una fase en la
pestaña «Fases» salen sus dos listas. **«Entregable» es el HITO (`milestone`)
de esa fase**: el CRM ya tenía el concepto —nombre, fecha, hecho o no, y su
fase— y crear una segunda tabla casi idéntica al lado habría sido duplicar por
el nombre. El rótulo dice «Entregables» porque es la palabra del cliente; el
modelo sigue llamándose `Milestone` y los endpoints, `/milestones`.

**3. La vista de fases.** `components/projects/VistaFases.jsx`, con los números
en `lib/projects/faseProgreso.js` (probado en `_smoke-fases-progreso.mjs`).
Cada fase enseña su porcentaje, su barra, el estado, cuántas tareas y
entregables lleva, lo que se está pasando de fecha, las horas estimadas, las
fechas y quién anda metido; la lista se ordena por avance, por fecha de fin o
por retraso. Se puede crear, editar (nombre, color, fechas), dar por completada
y borrar sin salir de ahí.

Tres decisiones del cálculo que conviene no deshacer sin pensarlo:

- **Tareas y entregables pesan lo mismo.** 8 tareas + 2 entregables son 10
  unidades al 10% cada una. Ponderar los entregables se pensó y se descartó:
  un porcentaje que no se puede recalcular a mano deja de ser un dato y se
  convierte en una opinión.
- **Una fase vacía está a `null`, no a 0%.** Un 0% dice «sin empezar» y un 100%
  dice «hecho»; una fase sin nada no dice ninguna de las dos, y pintarla al 0%
  la pone la primera en la lista de lo urgente sin que nadie haya prometido
  nada. En los órdenes por avance va siempre al final.
- **El avance del proyecto suma unidades, no promedia porcentajes.** Una fase
  con 1 de 1 y otra con 1 de 9 no son el 55%: son 2 de 10, o sea el 20%. La
  media miente en cuanto las fases tienen tamaños distintos, que es siempre.

De paso, **el porcentaje de la cabecera del proyecto cambia de fuente**:
contaba fases con `completedAt`, un campo que en la práctica nadie marcaba (un
proyecto con las tres fases a medias salía al 0%, y con las tres terminadas
también hasta que alguien se acordaba del botón). Ahora sale del mismo cálculo
que la vista de Fases, para que las dos cifras no se contradigan.


## 5. Endpoints REST

### 5.1 Sprint 1 — proyectos / fases / hitos / columnas / miembros

(Sin cambios. Detalle en `docs/qa/sprint-qa-2026-05/05-projects.md`.)

### 5.2 Sprint 2 — tasks

| URL                                                                | Verbos          | Notas                                       |
|--------------------------------------------------------------------|-----------------|---------------------------------------------|
| `/api/projects/[id]/tasks`                                         | GET, POST       | Lista + crear. Filtros: boardColumnId, phaseId, milestoneId, assigneeId, search, tagsAny |
| `/api/tasks/[id]`                                                  | GET, PATCH, DELETE | Detalle, edit, hard delete (CASCADE en task_assignees) |
| `/api/tasks/[id]/move`                                             | PATCH           | Body `{ targetBoardColumnId, targetOrder }`. Recompacta origen + abre hueco destino en una transacción. |
| `/api/projects/[id]/columns/[columnId]/reorder-tasks`              | PATCH           | Body `{ order: [{id, order}, ...] }`. Patrón nutricion-style con validación gap-free + doble pasada defensiva. |
| `/api/projects/[id]/board`                                         | GET             | Vista agregada `{ project, columns: [{..., tasks: [...]}] }` con includes anidados. |

Los 4 endpoints que serializan `assignees` incluyen el campo
`avatarColor` (`#rrggbb`, generado deterministamente por id en
`migrate-team-members-avatar-color.js`). `TaskCard` y `TaskDrawer` lo
usan como `background` del avatar circular cuando no hay `avatarUrl`.
Detalle de la columna en `docs/modules/team.md`.

### 5.3 Body PATCH `/api/tasks/[id]`

Campos editables: `title`, `description`, `priority` (validado contra
`enum_tasks_priority`), `boardColumnId`, `phaseId`, `milestoneId`,
`estimatedHours`, `dueDate`, `checklist`, `tags`, `customFields`,
`assigneeIds` (reemplaza la lista N-a-N).

**`order` NO es editable aquí** — usar `/move` o `/reorder-tasks` para
mantener invariantes de orden.

### 5.4 AuditLog (Sprint 2)

| action                              | Entity      | Source                                                          |
|-------------------------------------|-------------|-----------------------------------------------------------------|
| `task.created`                      | Task        | POST /api/projects/[id]/tasks                                   |
| `task.updated`                      | Task        | PATCH /api/tasks/[id]                                           |
| `task.moved`                        | Task        | PATCH /api/tasks/[id]/move                                      |
| `task.deleted`                      | Task        | DELETE /api/tasks/[id]                                          |
| `project.column.tasks_reordered`    | BoardColumn | PATCH /api/projects/[id]/columns/[columnId]/reorder-tasks       |

### 5.5 IA de Proyectos (31/07/2026; `/ai/apply` el 12/08/2026)

Cuatro endpoints, todos con `hasModule("projects")`. Dos preguntan a la IA y
no escriben nada; los otros dos escriben lo que una persona ha revisado y no
llaman a la IA. La separación es a propósito: el paso que escribe no gasta
dinero ni necesita clave, y por eso la demo pública funciona de punta a punta.

| URL | Verbo | Qué hace |
|-----|-------|----------|
| `/api/projects/ai/generate` | POST | `{ prompt (10..4000), clientId? }` → **vista previa** de un proyecto entero (fases, tareas, hitos, miembros). BYOK del tenant (`lib/ai/anthropicKey.js`), `vetoAi`; sin clave → 503. En la demo responde SIMULADO (`demoForcesFakeAi` → `lib/projects/ai/fake.js`). Responde `{ plan, fake }`. |
| `/api/projects/ai/create` | POST | `{ plan, clientId?, status? }` → materializa el plan en UNA transacción (proyecto, columnas por defecto, fases, hitos, tareas a «Por hacer», miembros). El plan se **re-normaliza** con `normalizePlan`: nunca se confía en lo que manda el navegador. Audita `project.created` con `aiGenerated: true`. |
| `/api/projects/[id]/ai/edit` | POST | `{ instruction }` → **propuesta** de operaciones sobre el proyecto (mover/crear/borrar tareas, fases, miembros…) a partir de un snapshot del estado (`buildProjectSnapshot`). Solo admin o lead. Mismo BYOK/veto/demo que `generate`. |
| `/api/projects/[id]/ai/apply` | POST | `{ operations }` (máx. 100) → aplica las que el usuario dejó marcadas. Las operaciones vuelven a pasar por `normalizeOperations` contra un snapshot **recién leído de BD** (lo que ya no existe se descarta y se cuenta en `skipped`; nadie puede colar ids de otro proyecto). Solo admin o lead. Audita `project.ai_reorganized` con un RESUMEN (hay nombres de tareas y personas). **No existía hasta el 12/08**: el modal lo pedía y recibía 404. |

#### Por qué «no funcionaba» (01/09/2026, Rodrigo)

No era un bug del módulo: eran **tres relojes y un traductor que faltaba**, y
los cuatro salían por pantalla como «Error interno del servidor». Estos dos
endpoints son las llamadas más largas del CRM con diferencia —12.000 y 8.000
tokens de JSON, frente a los 700–3.000 de todo lo demás—, así que eran los
únicos a los que les caían encima:

1. **El timeout del SDK.** Se pedían los 12.000 tokens de golpe, sin `stream`,
   contra un tope de 120 s: a la velocidad normal del modelo eso no llega.
   Ahora `complete({ stream: true, timeoutMs: 300_000 })`.
2. **nginx**, con su `proxy_read_timeout` de 60 s de fábrica: la conexión estaba
   muda todo el rato y la cortaba antes de tiempo. Lo resuelve
   `lib/ai/respuestaConLatido.js`, que empieza a responder A LA VEZ que el
   trabajo y suelta un espacio cada 15 s (JSON admite espacios delante, así que
   el `res.json()` del navegador parsea igual).
3. **El parser**: una frase delante del JSON tiraba la respuesta entera.
   `extraerJson()` lo busca dentro — tal cual, dentro de la valla de markdown, o
   el primer objeto con las llaves equilibradas.
4. **El error de Anthropic no se traducía**: clave caducada, modelo retirado y
   proveedor saturado se veían todos igual. `lib/ai/errorLegible.js` los pasa a
   una frase que dice qué pasa y dónde se toca.

⚠️ **`generate` y `edit` contestan SIEMPRE 200.** Como el cuerpo empieza a
viajar antes de saber cómo acaba, el código HTTP ya está mandado: el fallo va
dentro (`{ ok: false, error }`). Todo lo que puede responder otro código
—`hasModule`, `vetoAi`, validación del cuerpo, falta de clave— se comprueba
ARRIBA, antes del latido. **Quien llame a estos dos tiene que mirar `j.ok`, no
solo `res.ok`.** Los otros dos (`create`, `apply`) siguen igual: escriben en BD,
tardan lo que tarda una transacción y responden con su código de siempre.

Detalle completo en
`../decisions/2026-09-01-la-portada-se-compone-con-los-modulos.md`.


UI: `AiProjectModal.jsx` (listado, «Crear con IA») y `AiEditModal.jsx` (ficha,
«Reorganizar con IA»). Lógica en `lib/projects/ai/` (§6).

#### Tres bordes de los filtros, cerrados el 21/08/2026

Los dos filtros (`normalizePlan` y `normalizeOperations`) son lo único que hay
entre el texto que devuelve el modelo y el schema del tenant. Tres cosas se
colaban por ahí, y las tres fallaban **calladas**: no había aviso que mirar.

1. **El `phaseIndex` de los hitos se TRADUCE.** Los hitos apuntan a su fase por
   posición, pero `normalizePlan` descarta fases por el camino (una sin nombre,
   o las que pasen del tope de 12) y el índice se comparaba contra la lista ya
   filtrada. Con fases `[sin nombre, B, C]`, el hito de B acababa colgado de C y
   el de C se perdía: un hito bien formado, en la fase equivocada, guardado en la
   base. Ahora se traduce el índice original al de la lista final, y lo que
   apuntaba a una fase descartada queda en `null` —hito sin fase—, que es la
   única lectura honesta.
2. **Los ids del equipo se buscan en minúsculas y se guarda SIEMPRE el id
   canónico de la base.** `UUID_RE` lleva `/i`, pero las comprobaciones contra el
   equipo eran exactas: un uuid que el modelo devolviera en mayúsculas pasaba la
   regex, no casaba con nadie y se descartaba sin un solo aviso. El plan salía
   sin asignar y no había forma de saber por qué. Afecta a `assigneeIds` y
   `members` de `normalizePlan`, y a `filtraAsignados`, `addMember` y
   `removeMember` de `normalizeOperations`. Lo que acaba en la FK es el valor de
   la base, no la variante que escribió el modelo.
3. **`removeMember` se valida contra `members` (los miembros DEL PROYECTO), no
   contra `team`.** `loadProjectSnapshot` carga el equipo con `status: "active"`,
   así que a quien causaba baja no se le podía sacar de sus proyectos, y encima
   se le contestaba «la persona indicada no es miembro del proyecto», que era
   falso: el propio snapshot lo llevaba en `members`. Es el caso corriente
   —alguien se va y hay que sacarlo de los proyectos— y era el único que no
   funcionaba. A quien de verdad no es miembro se le sigue descartando con esa
   misma frase, que ahí sí es cierta.

---

## 6. Helpers / libs

`lib/projects/`:

- `projectAuth.js` — `isAdminRole`, `isLeadOfProject`, `fetchLeadProjectIds`,
  `findOwnTeamMember`, `canEditProject`.
- `serializeProject.js` — mapper BD→API filtrando `budgetAmount` para no
  admin/no lead.
- `generateProjectCode.js` — `PRY-YYYY-NNNN` por MAX(code).
- `createDefaultBoardColumns.js` — siembra 4 columnas por defecto.
- **Sprint 2:** `serializeTask.js` — mapper BD→API; normaliza include
  `assigneeLinks → assignees`.
- `taskPriority.js` — enum, etiquetas en español, orden y estilos de la
  prioridad de tarea (Vista de Lista, 12/07/2026).
- `checklist.js` — `normalizeChecklistItems`: garantiza `{ id, text, done }` con
  `id` único en cada item del checklist JSONB. Es el arreglo del bug «marcar uno
  marca todos» (items sin `id` o con `id` duplicado). Se usa al cargar en el
  drawer y al persistir en POST/PATCH (y en `ai/create` y `ai/apply`).
- `ai/` — `prompts.js` (`buildGeneratePrompts`, `buildEditPrompts`),
  `parsePlan.js` (`normalizePlan`), `editOps.js` (`buildProjectSnapshot`,
  `loadProjectSnapshot`, `normalizeOperations`), `fake.js` (`fakeProjectPlan`,
  `fakeEditOps`: el modo demo sin coste, mismo contrato que la IA real).

Fuera de la carpeta: `lib/calendar/projectEvents.js` — `fetchProjectEvents`,
lo que el feed del calendario mezcla con sus tareas (§1). Vive en `calendar`
porque es el calendario quien lo llama; devuelve `[]` si no hay módulo.

---

## 7. Decisiones arquitectónicas

### S2-1. Body de `reorder-tasks` = `[{ id, order }]` (no `[uuid...]`)

Hay dos patrones de reorder coexistiendo en el repo:

| Patrón                                  | Usado en                                                | Pros/Contras                                              |
|-----------------------------------------|---------------------------------------------------------|-----------------------------------------------------------|
| `{ columnIds: [uuid, ...] }`            | `/projects/[id]/columns/reorder`, `/phases/reorder`     | Simple. Sin validación gap.                               |
| `{ order: [{ id, order }, ...] }`       | `/plans/[id]/meals/reorder` (nutricion C5)              | Defensivo (gap-free explícito). Más LOC validación.       |

**Elegimos el patrón nutricion-style** para `/columns/[columnId]/reorder-tasks`:

- Detecta huecos en el `order` requerido (0..N-1) antes de tocar BD.
- Detecta duplicados en el body.
- Es atómico con 2 pasadas (UPDATE = -1-i, luego UPDATE = target) defensivo
  contra futuros UNIQUE `(project_id, board_column_id, order)`.
- Coherente con sprint Recetario nutricion.

### S2-2. Asignados N-a-N con tabla puente, `Task.assigneeId` legacy mantenido

`Task.assigneeId` (Sprint 1) era 1-a-1. Para soportar multi-asignados
añadimos `task_assignees` (N-a-N). La migración hace **backfill** desde
`tasks.assignee_id` y **mantiene la columna activa** durante el sprint:

- Endpoints Sprint 2 leen/escriben SOLO `task_assignees` (vía `assigneeIds`).
- El serializer `serializeTask` expone `assignees: []` (canon) + `assigneeId`
  legacy (compat hasta Sprint 3).
- Backlog Sprint 3: eliminar `Task.assigneeId` + asociación `assignee` cuando
  no quede consumidor leyéndolo.

### S2-3. `Task.archivedAt` NO introducido. Hard delete.

Coherente con Phase/Milestone (también hard delete en este módulo). `CASCADE`
de `task_assignees` se encarga del cleanup. `customFields.seed` en seeds nos
da idempotencia sin necesidad de soft delete.

### S2-4. Drag-and-drop solo vertical (intra-columna + entre columnas)

Reorden de columnas NO se hace por DnD en el tablero. Las columnas se
gestionan en `ColumnsManager` (tab Configuración del proyecto) que ya tiene
`/api/projects/[id]/columns/reorder` esperando un caller futuro.

### S2-5. Move de tarea en una transacción

`/api/tasks/[id]/move` ejecuta TODO en una transacción:

1. Si cambia de columna → DECREMENT order en columna origen para tareas con
   `order > sourceOrder`.
2. INCREMENT order en columna destino para tareas con `order >= targetOrder`.
3. UPDATE de la tarea: `boardColumnId = target`, `order = targetOrder`.

Si el server falla en cualquier punto, la columna no queda con huecos ni
duplicados. Validación pre-flight de rango (`targetOrder ∈ [0, destCount]`
si cambia de columna, `[0, destCount-1]` si se queda).

### S2-6. `@dnd-kit/utilities` instalado pese a la nota

El prompt original pedía no instalar `@dnd-kit/utilities` sin justificación.
Lo instalamos porque `useSortable` necesita el helper `CSS.Transform.toString`
para aplicar el transform del drag. Sin él hay que escribir un helper a mano
con riesgo de breakage. La utilidad pesa ~2KB y es estable, así que es la
opción correcta.

### S2-7. Fix preexistente: `Project.code` modelo declara `unique: false`

BD tiene UNIQUE PARCIAL `WHERE code IS NOT NULL` (creado por migración
Sprint 1). El modelo Sequelize declaraba `unique: true` simple. Esa
divergencia hacía que `sync({alter:true})` intentase recrear el índice como
UNIQUE total y fallara con múltiples proyectos `code=NULL`. Cambio en
`models/tenant/Project.model.js`: `unique: false` + comentario explicativo.

Backlog: reflejar el índice parcial con `indexes:[{ unique: true, fields:
['code'], where: { code: { [Op.ne]: null } } }]` y mantener `unique: false`
en el campo.

---

## 8. Migraciones y seeds

| Script                                  | Descripción                                              |
|-----------------------------------------|----------------------------------------------------------|
| `scripts/migrate-projects-sprint-1.js`  | Crea estructura completa Sprint 1                        |
| **`scripts/migrate-projects-sprint-2.js`** | **Crea `task_assignees`, 4 índices en `tasks`, FK board_column. Idempotente. Solo tenants con módulo activo.** |
| **`scripts/migrate-projects-task-priority.js`** | **Añade `tasks.priority` (enum, default `medium`) para la Vista de Lista. Idempotente. Lee tenants de `master.tenants`. Local: `npm run db:migrate:projects-priority`. VPS: `docker exec -it crm-salamandra-app-1 node scripts/migrate-projects-task-priority.js` (NO el script `:prod` — el contenedor no lleva `.env.production`; ya tiene `DATABASE_URL` por `env_file` y `db` solo resuelve dentro de la red Docker).** |
| `scripts/seed-projects-demo.js`         | Sprint 1 + extensión Sprint 2 (8-12 tasks por proyecto, marker `projects-demo-tasks-v1`) |

Comandos npm:

```bash
npm run db:migrate:projects-2          # local
# producción: docker exec crm-salamandra-app-1 node scripts/migrate-projects-sprint-2.js
# (el atajo `:prod` sigue en package.json pero lleva `--env-file=.env.production`,
#  que el contenedor no tiene: dentro ya hay DATABASE_URL por env_file)

npm run db:seed:projects-demo          # idempotente
```

Normalmente no hace falta lanzarlas a mano: las tres están en
`MODULES.projects` de `scripts/_module-migrations.js` y las arrastra
`enable-module.js` (§2) y `ensure-tenant-schema.js`.

Detección de tenants en la migración (**sin filtrar por `status`**, regla 12:
el estado decide quién entra, no qué forma tiene su schema; el
`t.status = 'active'` se barrió el 12/08/2026):

```sql
SELECT t.slug FROM master.tenants t
JOIN master.tenant_modules tm ON tm.tenant_id = t.id
WHERE tm.module_key = 'projects' AND tm.enabled = TRUE
ORDER BY t.slug;
```

**Resultado esperado en local** (al ejecutar `db:migrate:projects-2`):

```
PostgreSQL: 16.x
▶ Obteniendo tenants con módulo projects activo...
  ✓ 2 tenants: aumenta, demo

▶ Aplicando migración (transacción global)...
· Schema crm_aumenta
  ✓ crm_aumenta.task_assignees: tabla creada (+ UNIQUE + idx team_member)
  ✓ crm_aumenta: migradas 0 filas legacy tasks.assignee_id → task_assignees
  ✓ crm_aumenta index tasks_project_column_order_idx: creado
  ✓ crm_aumenta index tasks_assignee_idx: creado
  ✓ crm_aumenta index tasks_phase_idx: creado
  ✓ crm_aumenta index tasks_milestone_idx: creado
  ✓ crm_aumenta.tasks tasks_board_column_fk: creada
· Schema crm_demo (idem)

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Resumen migración Proyectos Sprint 2                                                         │
├──────────────┬──────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┬──────┤
│ tenant       │ task_assign. │ backfill     │ idx 1    │ idx 2    │ idx 3    │ idx 4    │ FK   │
├──────────────┼──────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────┤
│ aumenta      │ creada       │ 0 filas      │ ✓ nuevo  │ ✓ nuevo  │ ✓ nuevo  │ ✓ nuevo  │ creada│
│ demo         │ creada       │ 0 filas      │ ✓ nuevo  │ ✓ nuevo  │ ✓ nuevo  │ ✓ nuevo  │ creada│
└──────────────┴──────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┴──────┘
```

(El backfill será 0 mientras no haya tareas con `assignee_id` poblado en BD;
sigue siendo idempotente para re-runs.)

---

## 9. Smoke tests

`scripts/smoke-test-kanban.mjs` — 13 pasos cubriendo todo el flujo CRUD +
move + reorder + AuditLog. Requiere `npm run dev` en otra terminal y demo
con su admin (admin@demo.salamandra).

```bash
$env:SMOKE_PASSWORD = "..."   # opcional, si no fija usa firma JWT directa
npm run smoke:kanban
```

Pasos cubiertos:

1. Health: server responde + 5 tablas accesibles.
2. Cleanup pre-run (proyectos `smoke-kanban-%`).
3. POST /projects → crea proyecto smoke + verifica 4 columnas por defecto.
4. POST /tasks ×4 → con assignees, verifica order incrementa.
5. PATCH /tasks/[id] → cambia title + tags + assignees.
6. PATCH /move → task1 col0 → col1 final.
7. PATCH /move (force shift) → task2 col0 → col1 inicio; task1 baja a order=1.
8. PATCH /reorder-tasks → invierte col1.
9. GET /board → verifica shape final.
10. GET /tasks?assigneeId → filtro funciona.
11. DELETE /tasks/[id] → recompactación de order en origen.
12. AuditLog: 5 actions presentes.
13. Cleanup.

---

## 10. Plan de testing manual (UI)

Ejecutar tras `npm run dev`:

| Caso | Pasos | Esperado |
|------|-------|----------|
| Abrir tablero desde la ficha | `/proyectos/<id>` → botón "Abrir tablero" de la cabecera | Navega a `/proyectos/<id>/board` con Kanban poblado |
| Drag task entre columnas | Drag de una card a otra columna | Card se mueve, persiste tras refresh, AuditLog `task.moved` |
| Drag intra-columna | Drag arriba/abajo en misma columna | Order persiste; los demás cards se reordenan |
| Crear task | Click "+ Añadir tarea" en una columna | Drawer modo create; al guardar aparece la card al final |
| Editar task | Click en card | Drawer modo view; cambios commit on blur; "Guardado" parpadea |
| Asignar multi | Multi-select de chips assignees en drawer | Avatares aparecen en card al cerrar drawer |
| Checklist | Añadir 3 items + marcar 2 | Contador "2/3" en card |
| Tags + filtro | Añadir tag, filtrar por tag en toolbar | Card visible/oculta según filtro |
| Borrar task | Drawer → "Eliminar tarea" → confirmar | Card desaparece, AuditLog `task.deleted` |
| Drawer móvil | Resize a 375px, abrir drawer | top-14 lg:top-0 → no tapa barra superior |
| Filtro búsqueda | Escribir en search box (debounced 300ms) | Solo tasks con match visibles |
| Sin assignees | Crear task sin asignados | Card sin avatares; no error |

---

## 11. Backlog técnico

### Sprint 3 (próximo)

- **Aplicar plantilla** a proyecto nuevo (`POST /projects/from-template`).
  Modelo `ProjectTemplate` ya tiene JSONB; falta el endpoint y UI.
- **Eliminar Task.assigneeId legacy** + asociación `assignee` 1-a-1 + columna
  `tasks.assignee_id` cuando ningún consumidor la lea.
- **WIP limit visual** — `BoardColumn` ya muestra `N/LIMIT` y marca rojo si
  supera; añadir bloqueo de drop para que dnd-kit rechace cards entrantes.
- **Pintar los proyectos donde se esperan**, contra endpoints que ya existen:
  los del cliente en `/clientes/[id]` (`/api/clients/[id]/projects`), los de
  una persona en `/equipo` (`/api/team/[id]/projects`) y el botón «convertir
  en proyecto» en `LeadsModule` (`/api/leads/[id]/convert-to-project`). Los
  tres componentes del Sprint 1 que iban a hacerlo se borraron el 20/08/2026
  por llevar un año sin que nadie los importara (§4): esto se escribe de
  nuevo cuando se pida, no se rescata de git.
- **UI reorder de fases y columnas** — `/phases/reorder` y `/columns/reorder`
  existen en API pero la UI no los llama.
- **Comentarios en tareas** — nuevo modelo `TaskComment` + endpoints + UI en
  drawer.
- **Adjuntos en tareas** — nuevo modelo `TaskAttachment`.
- **Reflejar UNIQUE parcial `projects_code` en modelo Sequelize** con
  `indexes:[{ unique: true, fields:['code'], where: { code: { [Op.ne]: null } } }]`.
- **Limpieza producción: índices duplicados `projects_code_key*`** — el mismo
  bug detectado y limpiado en local (residuos de `sync({alter:true})` cuando
  el modelo declaraba `unique: true` simple). Hay que ejecutar
  `scripts/cleanup-projects-code-indexes.js` contra producción **tras backup
  BD**. El script lleva guard que aborta si detecta `prod`/`production` en
  el host/dbname, así que para producción habría que adaptarlo (override
  temporal del guard o variable de bypass explícita). Inventario observado
  en local antes del cleanup: 11 constraints UNIQUE TOTALES huérfanas
  distribuidas en `crm_aumenta` (2), `crm_demo` (6), `crm_retorika` (3).
  Producción puede tener más por antigüedad.
- **Auditoría global de índices `_key[0-9]+$` en todos los schemas** — el
  patrón "constraint UNIQUE acumulada por `alter`" puede haber afectado a
  otros modelos que hubieran tenido `unique: true` simple en algún momento.
  Query de inventario:
  ```sql
  SELECT schemaname, tablename, indexname FROM pg_indexes
  WHERE schemaname LIKE 'crm_%' AND indexname ~ '_key[0-9]+$';
  ```
  Si hay coincidencias, generalizar el cleanup script.

### Sprint 4

- **TimeEntry** + `ProjectMember.removedAt` (soft remove con histórico).
- **Activar FK durmientes** Cost/Invoice → Project (lógica de imputaciones).

### Quick wins

- **Stats `/api/projects/[id]/stats`** — tareas por columna, % completado
  (via `isDoneColumn`), atrasadas (`dueDate < hoy`), sin asignar, horas
  estimadas vs imputadas.
- **Export** XLSX `/api/projects/export` siguiendo patrón
  `/api/clients/export`.
- **Bulk move** `POST /projects/[id]/tasks/bulk-move`.
- **Search debounce server-side** — hoy filtra cliente; con muchos proyectos
  conviene pasar `search` al backend.

### Apuntes detectados (sin acción)

- Si hay huérfanos en `tasks.board_column_id` al ejecutar la migración
  Sprint 2, la FK se salta con warning. El operador debe limpiar antes de
  reintentar.
- `Task.checklist` es JSONB embebido. Sin normalización a tabla separada (no
  hay caso de uso que lo justifique todavía).
- `isDoneColumn` único por proyecto solo se garantiza en API, no en BD.
  Si se quiere blindar: `CREATE UNIQUE INDEX ... ON board_columns(project_id)
  WHERE is_done_column = true`.

---

## 12. Recap del sprint Sprint 2

| Checkpoint | Local | Producción | Notas                                                       |
|------------|-------|------------|-------------------------------------------------------------|
| S2-1 BD + modelos | 2026-06-29 | desplegado | migrate + task_assignees + índices + FK + fix Project.code |
| S2-2 Endpoints REST | 2026-06-29 | desplegado | 8 endpoints + serializeTask                                |
| S2-3 Frontend Kanban | 2026-06-29 | desplegado | KanbanBoard + BoardColumn + TaskCard + TaskDrawer + /board |
| S2-4 Seed + smoke + docs | 2026-06-29 | desplegado | seed extendido + 13 pasos smoke + docs/modules/projects.md |

> **Histórico:** el Sprint 2 entró en `master` el 01/07/2026 (`aa70a99`) y se
> desplegó con `deploy.sh --full` (deps `@dnd-kit`) y la migración dentro del
> contenedor. Hoy producción lleva el mismo commit que local y el módulo está
> en cinco clientes (ver la cabecera); los pasos de subida que había aquí ya no
> describen nada pendiente.
