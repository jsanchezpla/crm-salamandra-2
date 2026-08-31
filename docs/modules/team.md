# Módulo de Equipo & RRHH (`team`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `team` · requiere — (funciona solo) · `team_avanzado` requiere `team` y, según la pantalla, `clinica` (Desempeño, Dirección, Productividad, Incidencias, Bandeja) o `citas` (Ocupación); solo Actividad va con `team_avanzado` a secas (`lib/provisioning/dependencias.js`) · `fichaje` requiere `team` y es módulo aparte (`fichaje.md`) |
| **Reina** | — · sin reina declarada; las siete pantallas de `team_avanzado` y su `adminOnly` nacieron a petición de Aumenta (comentarios en `components/layout/Sidebar.jsx`) |
| **Pantallas** | `team`: `/equipo` → `app/(dashboard)/equipo/page.jsx` (plantilla, drawer de alta/edición, horario, «Acceso al CRM»; al no admin le pinta `MiEquipo`) · `team_avanzado`: `/equipo/mi-desempeno`, `/equipo/desempeno-config`, `/equipo/direccion`, `/equipo/productividad`, `/equipo/incidencias`, `/equipo/bandeja` (con `clinica`), `/equipo/ocupacion` (con `citas`), `/equipo/actividad` → `app/(dashboard)/equipo/<carpeta>/page.jsx`, con sus piezas en `app/(dashboard)/equipo/_components/` (el paciente de `IncidenciaModal` se elige con `SelectorPaciente` —busca en el servidor, 31/08/2026: el desplegable cortaba en 1.000 y Aumenta tiene 1.174—, vigilado en `_smoke-selector-fichas`) · `fichaje`: `/equipo/fichaje` · el grupo del menú se ve con `team` O `clinica` (`visibleModules`) |
| **Endpoints** | `app/api/team/**` — 13 `route.js`: `route.js` (listado/alta), `[id]` (detalle, edición, baja lógica), `[id]/borrar` (GET la radiografía, DELETE el borrado definitivo), `modules` y `[id]/modules`, `[id]/access` (+ `password`: el login del miembro, escribe en `master.users`), `[id]/hours` (horario), `me` y `me/documents` (+ `[id]`) (autoservicio; gate `team` O `clinica` a nivel de tenant), `[id]/billing-summary` (gatea `billing`), `[id]/projects` (gatea `projects`) · `team_avanzado` — 18 `route.js` con `hasModule("team_avanzado")`: `app/api/actividad`, `app/api/clinica/performance/**`, `app/api/clinica/productividad/**`, `app/api/clinica/incidencias/**`, `app/api/clinica/incentive-items/**`, `app/api/clinica/dashboard`, `app/api/clinica/bandeja` y `app/api/citas/informe-ocupacion` (desde el 31/08/2026 la bandeja, la campana y el bloque Mi trabajo miran las incidencias por la tabla PIVOTE —todos los responsables, no solo el principal— con `lib/clinica/incidenciasDe.js` y su prueba; y la portada gana la tarjeta «Incidencias abiertas» en Pendiente, mismos gates que el endpoint) · `app/api/auth/me` (`enabledModules`) · Públicos: ninguno |
| **Lógica** | `lib/team/`: `serializeTeamMember.js` (BD → API; oculta coste y salario a quien no es admin) · `access.js` (crear, cambiar y quitar el login y su `moduleAccess`) · `currentTeamMember.js` (qué `TeamMember` es el usuario logueado) · `rastro.js` (qué queda de una persona en el schema y si su ficha se puede borrar) · `lib/auth/correoCuenta.js` (el correo de una cuenta, que NO es su usuario; puro, sin imports, lo usa también el navegador) + `correoCuentaDb.js` (sus consultas) · Actividad: `lib/actividad/etiquetas.js` (acción de auditoría → frase) · las pantallas avanzadas tiran de `lib/clinica/` |
| **UI** | `components/layout/AvisoCorreoCuenta.jsx` (la barra de «tu cuenta no tiene correo», en el shell) · `components/team/`: `AccessSection.jsx` («Acceso al CRM»: usuario + correo + contraseña al crear, y poner o cambiar el correo de una cuenta que ya existe), `CredentialsModal.jsx` (la contraseña una sola vez), `BorrarFichaModal.jsx` (el aviso antes de borrar, con la radiografía dentro), `TeamHoursEditor.jsx` (horario; también en `/mi-horario`, de Citas), `MiEquipo.jsx` (mini-módulo del no admin) · `components/billing/EmployeeBillingSection.jsx` embebido en la ficha · no hay `modules/team/` |
| **Modelos** | `TeamMember` (`team_members`), `TeamMemberHours` (`team_member_hours`), `TeamMemberModule` (`team_member_modules`, espejo informativo de `moduleAccess`); en `master`: `User` (`users`; `module_access` es la segunda puerta; `email` es el IDENTIFICADOR y `email_contacto` el buzón —único, y también sirve para entrar—, con un hook `beforeCreate` que no deja nacer una cuenta sin correo) y `AuditLog` (`audit_logs`, lo que lee Actividad) · `team_avanzado` lee modelos de Clínica y Citas: `PerformanceMetric`, `IncentiveItem`, `Incidencia`, `IncidenciaAssignee`, `Booking` |
| **Interruptores y parámetros** | ninguno que lea el código (ni `featureFlags` ni `logicOverrides`); lo que decide es el rol (fresco de BD en `access`), `visibleModules: ["team", "clinica"]` y `requiresAll` de `components/layout/Sidebar.jsx`, y `users.module_access` |
| **Pantallas propias** | ninguna (letrero `ui_override` vacío en producción) |
| **Scripts** | activar: `node scripts/enable-module.js <slug> team` (y `team_avanzado`); `MODULES.team` de `scripts/_module-migrations.js`: `migrate-team-fields`, `migrate-rename-therapist-to-employee`, `migrate-team-modules-salary`, `migrate-team-members-avatar-color`, `migrate-team-specialties`, `migrate-team-weekly-hours`, `migrate-team-member-hours` (+ CORE `migrate-team-members-block-color` y `migrate-team-colegiada`); lo de `team_avanzado` va en `MODULES.clinica` (`migrate-incidencias-module`, `migrate-incentive-items`, `migrate-clinica-performance-roles`) · seeds: `seed-team-demo.js` (`npm run db:seed:team`), `_hechos/seed-aumenta-equipo-real.js` (el equipo real de Aumenta, 24/07/2026: no relanzar) · accesos: `check-module-access.js` (`npm run db:check-access`), `grant-module-access.js` (ojo: `[]` = «no tocar», al revés que el gate) · Actividad: `migrate-audit-logs-index.js` (master, ONE_OFF ya corrido), `podar-audit-logs.js` (retención) · `npm run db:check-links` (`team_member_id` en `plans`, `interactions`, `client_notes`…) · correo de cuenta: `migrate-users-email-contacto.js` (`npm run db:migrate:correo-cuenta`, MASTER, va ANTES del despliegue) y `backfill-correo-cuenta.js` (copia el correo de la ficha; en seco por defecto) |
| **Pruebas** | `scripts/_smoke-correo-cuenta.mjs` (`node:test`, 26/08/2026, en `npm test`, 28 casos): la forma de un correo, la caída a `email`, que MANDE el identificador cuando dos cuentas responden al mismo texto, que las tres puertas lo exijan y que dos identificadores no den el doble de intentos · `scripts/_smoke-team-borrar.mjs` (`node:test`, 26/08/2026, en `npm test`): las tres puertas del borrado, que las columnas sin FK sigan declaradas y que ni la pantalla ni el modal decidan por su cuenta · `scripts/_smoke-actividad-etiquetas.mjs` (`node:test`, 19/08/2026, en `npm test`): `lib/actividad/etiquetas.js` —las frases, el traductor genérico, módulos y prefijos— y un CRUCE que lee todos los `action: "x.y"` de `app/api` y `lib` y exige frase propia (el 19/08 faltaban 21 y ganaron la suya ese día; `DEUDA_CONOCIDA` está vacía): una acción nueva sin frase pone la prueba en rojo; y que ningún prefijo con frase caiga en «Otros» (el filtro «Configuración» buscaba `tenant.*` y se escribe `configuracion.*`) · `scripts/_smoke-team-colegiada.mjs` (`node:test`, 28/08/2026, en `npm test`, 18 casos): el nº de colegiación y la titulación de quien firma un informe — que el serializer los devuelve `null` y nunca `""` (una cadena vacía imprimiría una línea en blanco bajo una firma), que el POST los mete de verdad en el `TeamMember.create` y no solo los lee, que el PATCH los edita y vaciarlos vale, y que la migración está en **CORE** y no en `MODULES.team` (el modelo declara las columnas para TODOS los tenants: en el módulo sería un 42703 en Equipo y en los desplegables de profesionales de cualquier cliente sin `team`) · las que nombran `TeamMember` son de Citas (`_smoke-horario-profesional.mjs`, `_smoke-bloqueos-quien-ve.mjs`, `_smoke-citas-sin-profesional.mjs`) |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-07-28-repaso-de-seguridad.md` (el rol fresco de `withTenant`, de lo que viven los endpoints de `access`) · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` · `../decisions/2026-08-26-el-correo-de-una-cuenta-no-es-su-usuario.md` |
| **En este doc** | Modelos · Filtrado de campos sensibles · Eventos de auditoría · Endpoints · Frontend · Migración y backfill · El correo de una cuenta — 2026-08-26 · Actividad (registro legible) — 2026-07-27 |

> Documentación de detalle. Referencia rápida en `CLAUDE.md` (sección
> "Módulos del CRM"). Si encuentras una discrepancia con el código,
> prevalece el código: actualiza este fichero.

## Visión general

Nació como CRUD mínimo de miembros del equipo del tenant: un MVP cuyo
propósito real era servir de base a módulos posteriores (Proyectos, Soporte,
Planificación, Comunicaciones) y a Facturación, no implementar RRHH completo.
Cubre lo imprescindible: identificar a la persona, asignarle un rol, calcular
rentabilidad (coste/tarifa por hora) y poder vincularla a un User para
permisos. Hoy ya no es «una sola página, un solo modelo»: bajo `/equipo` hay
diez páginas (la plantilla, las ocho de `team_avanzado` y Fichaje, ver el Mapa)
y tres modelos (`TeamMember`, `TeamMemberHours`, `TeamMemberModule`). Lo que
sigue siendo único es el serializer.

## Lo que NO hace (por ahora)

- Vacaciones / ausencias.
- Contratos / nóminas.
- Capacity planning / carga de trabajo.
- Organigrama visual.
- Página detalle como ruta propia (`/equipo/[id]`). El detalle vive en el
  drawer del listado, no hay permalink compartible.

## Borrar una ficha de verdad — 2026-08-26

Hasta el 26/08/2026 Equipo solo tenía **baja lógica**: `DELETE /api/team/[id]`
pone `status = 'inactive'` y revoca el login, pero la fila se queda para
siempre. Para la persona que trabajó tres años eso es lo correcto —su nombre
firma sesiones y facturas—, pero para la ficha creada por error deja basura
en la plantilla.

El borrado de verdad vive en `app/api/team/[id]/borrar/route.js` y **bloquea**
en vez de avisar. Tres puertas, y las tres las mide el SERVIDOR:

1. La ficha está `inactive`. Es la condición que puso Jorge: primero se da de
   baja, luego se borra. `on_leave` no vale: esa persona vuelve.
2. No le cuelga ningún `userId`.
3. **No queda ni una fila suya en todo el schema** — de las que son historia
   de OTRO. Sus propios ajustes no cuentan (ver abajo).

La tercera es la interesante. La lista de dónde mirar NO está escrita a mano:
`lib/team/rastro.js` se la pregunta a `pg_constraint`, y **a todos los schemas
`crm_%`, no solo al del cliente que se está mirando**. El motivo es que la
misma columna tiene FK en unos schemas y no en otros —`bookings.team_member_id`
la tiene en 8 y no en `nutri_laura`— porque el alta de tenant lanza `sync()`
antes que las migraciones. Qué columnas apuntan a una persona es una propiedad
del producto; que en un schema falte la FK es un accidente de cómo nació.

Quedan tres columnas que guardan el id de un miembro **sin FK en ningún
sitio**, y esas van declaradas en `COLUMNAS_SIN_FK` con la medición que las
justifica: `assets.assigned_to` (3 filas en producción, las 3 de equipo) y las
dos de `booking_change_requests`. La prueba vigila también el lado contrario:
que no se cuele en esa lista una columna que en realidad guarda un id de
`master.users` (`team_blocks.created_by_id`, `documents.owner_user_id`,
`recipes.created_by`…), porque eso dejaría el botón sin aparecer nunca.

Son **40 columnas** de 34 tablas, y medirlas cuesta ~40 ms por ficha.

**Lo suyo no bloquea** (`TABLAS_SUYAS`). Tres tablas son la ficha, no historia
de nadie: `team_member_modules` (el espejo informativo de sus accesos),
`team_member_hours` (su horario) y `team_blocks` (sus vacaciones). Se van CON
ella y el aviso las enseña bajo «Se irá con ella», pero no impiden borrar.

> Esto lo cazó el primer uso real, horas después de desplegar el botón. La
> ficha de prueba de Aumenta salió BLOQUEADA por 21 filas de
> `team_member_modules`… que se escriben SOLAS al crearle el login, una por
> módulo del cliente. Con la regla original, **cualquier ficha que alguna vez
> tuvo acceso al CRM era imposible de borrar para siempre**: justo el caso para
> el que se hizo el botón. Y había una contradicción dentro: esa misma mañana
> `team_blocks` se puso en CASCADE razonando «sus vacaciones se van con ella»,
> y el rastro las contaba como bloqueo.

Que son suyas no es una opinión: el modelo de `TeamMemberModule` lo dice en su
cabecera («puramente informativa/organizativa: NO bloquea nada») y las tres
están declaradas `onDelete: "CASCADE"` en `lib/db/tenantDb.js` y medidas como
CASCADE en los 12 schemas de producción, sin excepción. Aun así, `borrarLoSuyo()`
las borra **a mano dentro de la transacción**: el `ON DELETE` de un schema
depende de cómo nació, y fiarse de él es fiarse de un accidente.

Si algo bloquea, **no hay botón**: el modal enseña qué queda («3 facturas»,
«15 sesiones clínicas») y explica que la ficha se queda inactiva. Sin casilla
de «sé lo que hago» ni teclear el nombre: delante de 22.000 sesiones eso se
marca sin leer.

El `DELETE` **vuelve a medir** aunque el navegador ya lo hiciera (el modal
puede llevar horas abierto), va en transacción y traduce el `23503` de
PostgreSQL —alguien le colgó algo entre la medición y el borrado— a un 409 en
cristiano. Queda en auditoría como `team.deleted`, con un resumen (nombre,
puesto, estado) y nunca la ficha entera.

> ⚠️ Esto solo es seguro desde que `migrate-fks-equipo-alineadas.js` alineó los
> `ON DELETE` (26/08/2026, mismo día). Antes,
> `clinical_reports.therapist_id` era `CASCADE` en 8 de los 9 clientes con
> Clínica: un borrado se habría llevado los informes por delante, sin auditoría
> ninguna, porque la cascada la ejecuta PostgreSQL.

## Modelos

### TeamMember

Fichero: `models/tenant/TeamMember.model.js`. Tabla: `team_members`.

| Campo (BD) | Tipo | Notas |
| --- | --- | --- |
| `userId` | UUID nullable, **UNIQUE** | Vínculo opcional al `User` del schema `master`. PostgreSQL trata varios `NULL` como distintos en un UNIQUE estándar, así que pueden coexistir miembros sin User (externos, subcontratados). |
| `displayName` | STRING NOT NULL | Nombre visible. Único campo realmente obligatorio. |
| `email` | STRING nullable, UNIQUE | Validación regex propia (no el `isEmail` de Sequelize). El endpoint normaliza `""` y whitespace a `NULL` antes de guardar para que el UNIQUE no choque entre vacíos. |
| `position` | STRING nullable | Rol funcional ("Empleado Senior", "Comercial"). En la API se expone como `role`; ver "Renombrados". |
| `department` | STRING nullable | Texto libre. |
| `phone` | STRING nullable | |
| `avatarUrl` | STRING nullable | URL del avatar. Si está vacío la UI pinta iniciales. |
| `avatarColor` | VARCHAR(7) nullable, `field: avatar_color` | Hex `#rrggbb` usado como fondo del avatar circular cuando no hay `avatarUrl`. Backfill determinista por `id` (MD5), así que el mismo miembro mantiene el mismo color en cualquier entorno y tras un reseteo. Lo consume Sprint 2 Proyectos (`TaskCard`, `TaskDrawer`) y queda disponible para futuros módulos. Migración: `scripts/migrate-team-members-avatar-color.js`. |
| `blockColor` | VARCHAR(7) nullable, `field: block_color` | Hex `#rrggbb` de SUS bloqueos de agenda (10/08/2026, Rodrigo). `NULL` = hereda el general del centro (`settings.citas.colorBloqueos`), por eso la migración `migrate-team-members-block-color.js` NO hace backfill. Campo aparte de `avatarColor` a propósito: ese ya pinta sus citas, y un bloqueo del mismo color que una cita no se distingue. Ver `lib/citas/coloresBloqueo.js`. |
| `hourlyCost` | DECIMAL(10,2) nullable, ≥ 0 | Coste interno. **Solo admin/superadmin** lo ve y edita. |
| `hourlyRate` | DECIMAL(10,2) nullable, ≥ 0 | Precio facturable al cliente. Visible para todo autenticado del tenant. |
| `annualGross` | DECIMAL(10,2) nullable, ≥ 0 | Bruto anual. Es la **fuente de verdad de la retribución**: `monthlySalary` se CALCULA a partir de él. **Solo admin/superadmin.** Lo añade `migrate-team-modules-salary.js` (backfill `monthly_salary × 12` para quien ya tenía mensual). |
| `paymentPeriods` | INTEGER NOT NULL, `12` o `14` | Nº de pagas al año. Default 12. Misma migración. |
| `monthlySalary` | DECIMAL(10,2) nullable, ≥ 0 | Salario mensual. Hoy es **DERIVADO** (`annualGross / paymentPeriods`, calculado y persistido en el PATCH; la API no lo acepta directo). **Solo admin/superadmin**. Informativo: NO se cuenta como coste real (eso lo hace `Cost.type = 'salary'` en billing). Se añadió en la migración del rework de Facturación, no en la del MVP; si un miembro nunca tuvo `annualGross` (legacy solo-mensual), el PATCH no le toca el mensual. |
| `currency` | VARCHAR(3) NOT NULL | Default `EUR`. Se almacena siempre en mayúsculas, máximo 3 caracteres. |
| `status` | ENUM | `active`, `inactive`, `on_leave`. `on_leave` está **dormido** en el MVP: no se ofrece como opción nueva en el formulario, pero si llega de BD se respeta y se renderiza. |
| `hiredAt` | DATEONLY nullable | Fecha de incorporación. En la API se expone como `startDate`; ver "Renombrados". |
| `notes` | TEXT nullable | Texto libre. |
| `customFields` | JSONB | Default `{}`. Extensión libre por tenant. |
| `specialties` | JSONB NOT NULL, default `[]` | Especialidad(es) clínica(s) del profesional (Nutrición, Logopedia, Psicología…); taxonomía en `lib/clinica/specialties.js`. Array porque puede cubrir varias. Solo tiene sentido si atiende pacientes (Clínica o Nutrición). El serializer devuelve además `specialtyLabels`. Migración: `migrate-team-specialties.js` (sin backfill: `position` es texto libre). |
| `collegiateNumber` | VARCHAR(40) nullable, columna `collegiate_number` | Nº de colegiada de quien firma (28/08/2026, Aumenta). Sale IMPRESO en el informe clínico que la familia presenta en el colegio o para la beca del Ministerio. **Opcional y sin default**: hoy no lo tiene nadie, y un valor inventado se imprimiría bajo una firma profesional; `NULL` = «no lo tenemos» y el PDF se salta esa línea. El serializer normaliza `""` a `NULL` (`|| null`, no `?? null`) para que faltar sea una sola cosa. Migración: `migrate-team-colegiada.js`, en **CORE** (el modelo lo declara para todos los tenants). |
| `qualification` | VARCHAR(120) nullable | Titulación de quien firma («Graduada en Psicología»), misma historia y misma migración que `collegiateNumber`. Campo propio a propósito: no se reutiliza `position` —que ya se expone como `role` y se pinta en media docena de desplegables— ni `customFields` ni `specialties`. |
| `weeklyDirectHours` | INTEGER nullable, 0–80 | Horas objetivo de intervención directa por semana: el denominador de la productividad (`lib/clinica/productivity.js`, `/equipo/productividad`). `NULL` = sin objetivo → productividad N/D. **No pasa por el serializer**: lo escribe `PUT /api/clinica/productividad/hours` (`team_avanzado` + clínica) y lo lee la consulta de productividad. Migración: `migrate-team-weekly-hours.js`. Desde el 31/08/2026 la agregación (`lib/clinica/productivityQuery.js`, con `EventType`/`TeamBlock`/`PatientTherapist` OPCIONALES — el dashboard y la portada siguen con dos modelos) separa además el trabajo INTERNO: bloqueos «Reservado T.I.» y «Reunión equipo» de la agenda (texto libre en tres grafías, normalizado en `lib/clinica/trabajoInterno.js` con su prueba) y las valoraciones iniciales a pacientes NO asignados a esa terapeuta; y desglosa las citas directas en bono (packId) / taller (por nombre del tipo) / normal. La tabla enseña «Internas» (T.I./eq. debajo) y el desglose. |

#### Renombrados BD ↔ API

Para evitar que `position` colisione con `User.role` (que vale
`admin`/`user`/`superadmin`) y para mantener nomenclatura limpia hacia el
cliente, dos columnas se exponen con otro nombre. El renombre **no** se
hizo en BD; se hace en serialización.

| Columna en BD | Campo en API |
| --- | --- |
| `position` | `role` |
| `hiredAt` | `startDate` |

### `lib/team/serializeTeamMember.js`

Único punto de mapeo BD → API. Recibe la instancia de Sequelize (o un
objeto plano) y `{ isAdmin }`. Aplica el renombre, añade `hourlyCost`,
`annualGross`, `paymentPeriods` y `monthlySalary` solo si `isAdmin = true`,
y deja el resto siempre visible (incluidos `blockColor`, `specialties`,
`specialtyLabels`, `collegiateNumber` y `qualification`; `weeklyDirectHours` no
sale por aquí). Usar **siempre**
este serializer en respuestas del módulo: listado, detalle, post-create y
post-update lo invocan.

## Filtrado de campos sensibles

Decisión de seguridad central del módulo. El filtrado se hace **siempre
en el backend antes de serializar el JSON**, nunca solo en el frontend.

- `hourlyCost`: solo admin/superadmin.
- `annualGross`, `paymentPeriods`, `monthlySalary`: solo admin/superadmin
  (el mensual se añadió en el sprint billing; el bruto y las pagas después).
- `hourlyRate`, `email`, `phone`, `notes`, etc.: visibles para cualquier
  autenticado del tenant.

Endpoints donde aplica:

- `GET /api/team` → cada miembro pasa por `serializeTeamMember`… **salvo que**
  quien pregunta no tenga `team` en su `moduleAccess`: entonces pasa por
  `serializeProfesional` (la lista recortada, ver abajo).
- `GET /api/team/[id]` → idem.
- `GET /api/team/[id]/billing-summary` → adicionalmente filtra
  `data.employee.monthlySalary` y `data.projectedSalaryCost` cuando el
  viewer no es admin.
- `GET /api/billing/analytics/employees` → mismo criterio:
  `monthlySalary` y `projectedSalaryCost` solo se serializan para admin,
  y la whitelist de `sortBy` también los excluye para no-admins.


### La contraseña la escribe SIEMPRE quien la da (26/08/2026, Lau y Jorge)

Crear un acceso o restablecer una contraseña desde Equipo daba siempre una
aleatoria de 12 caracteres. Sobre el papel es lo más seguro; en un centro de 16
personas donde la dirección las reparte por teléfono, `k3Jq_8vTz2Lm` se dicta
mal, se copia peor y acaba en un papel encima del monitor. Es la misma
conclusión que ya estaba escrita en `lib/auth/contrasena.js` para «cambiar mi
contraseña»: lo que hace fuerte a una contraseña es el LARGO, no que sea
impronunciable.

`POST /api/team/[id]/access` y `POST /api/team/[id]/access/password` exigen
ahora `password` en el cuerpo. **No hay generador.**

⚠️ **Primero se dejó opcional —vacío = te genero una— y duró unas horas.** Jorge
lo cerró el mismo día: una opción que casi nadie va a querer sigue costando una
decisión cada vez, y la que se elige por inercia era justo la aleatoria que se
venía a quitar. Si mañana alguien echa de menos el generador, la respuesta no es
devolver el interruptor sino un botón de «sugerir una» que escriba en el campo
algo que se pueda leer, editar y dictar.

Las cinco cosas que lo sujetan, y que fija
`scripts/_smoke-team-contrasena-elegida.mjs`:

1. **Sin contraseña se rechaza**, nunca se inventa una. `generatePassword` ya no
   se importa en ninguno de los dos endpoints (sigue viva para el alta de un
   tenant en `lib/provisioning/altaTenant.js` y para las demos).
2. **Las reglas son las MISMAS** que las de `/api/auth/password`, porque es la
   misma función: `revisarContrasena`. Mínimo 10 caracteres, tope de 72 **bytes**
   (el de bcrypt, que descarta el resto en silencio), y fuera lo que se adivina
   en los primeros intentos.
3. **Se comprueba contra el usuario de quien RECIBE** la contraseña, no contra el
   de quien la escribe. `elena_aumenta` es mala contraseña para Elena, aunque
   quien la teclee sea la dirección.
4. **No vuelve por la red ni entra en la auditoría.** El alta responde
   `{ username, rol, modules }` y el reset `{ username }`; la pantalla enseña la que
   acaba de teclearse. El resumen de auditoría guarda el usuario y nada más.
5. **Las guardas de siempre siguen enteras**: solo dirección con rol fresco de
   BD, nunca EDITAR cuentas admin ni la propia (`loadManagedUser`), nunca en la demo,
   bcrypt 12 rondas y `tokenVersion +1` para tumbar las sesiones vivas. En el
   alta, además, la contraseña se valida **antes** de crear el usuario: un
   rechazo no deja un login a medias en `master`.

En la pantalla el campo va en **texto visible**, a propósito: quien la escribe
se la va a dictar a la persona, y con puntitos no hay forma de ver una errata.
Los dos botones —«Crear usuario» y «Poner esta contraseña»— están apagados hasta
que hay algo escrito, para que el rechazo del servidor no llegue nunca.

⚠️ **De camino apareció un agujero que era de antes.** `1234567890` se aceptaba
como contraseña —también en «cambiar mi contraseña», desde que se escribió el
fichero—: la lista de tiradas de teclas guardaba `0123456789`, pero la fila del
teclado va `1234567890`, y ni la tira ni su reverso contienen esa rotación.
Arreglado poniendo el `0` a los dos lados (`01234567890`), con su caso en
`_smoke-contrasena.mjs`. Comprobado además en producción que no la usaba nadie:
29 cuentas vivas contra cinco variantes, cero coincidencias.

### La lista recortada: «quién trabaja aquí» no es «qué cobra quién» (26/08/2026)

`GET /api/team` tiene **dos puertas**, y confundirlas rompió una pantalla:

| La pregunta | Con qué se contesta | Qué devuelve |
| --- | --- | --- |
| ¿Tiene el **CENTRO** equipo? | `tenantHasModule("team")` | Si no: 403, como siempre. |
| ¿Puede **esta persona** abrir la pantalla de Equipo? | `hasModule("team")` | Si no: `serializeProfesional` — `id`, `userId`, `displayName`, `role`, `status`, `avatarUrl`, `avatarColor`, `blockColor`, `specialties`, `specialtyLabels` y `tieneHorario`. **Nada más.** |

Fuera de la lista recortada, declarado en `CAMPOS_FUERA_DE_LA_LISTA`
(`lib/team/serializeTeamMember.js`): `email`, `phone`, `notes`, `department`,
`startDate`, `hourlyRate`, `currency`, `hourlyCost`, `annualGross`,
`paymentPeriods`, `monthlySalary`, `collegiateNumber` y `qualification`. Los dos
últimos no son dinero ni datos de contacto: se quedan fuera porque en el recorte
solo entra lo que hace falta para **pintar y elegir** a una persona, y quien los
necesita de verdad es el PDF del informe, que se genera en el servidor leyendo
la ficha entera. El buscador `q` tampoco mira el correo
cuando la lista va recortada: devolver un correo está cerrado, así que
adivinarlo letra a letra también.

**De dónde sale.** Las quince terapeutas de Aumenta no llevan `team` en sus
accesos —no tienen por qué ver los sueldos—, así que recibían un **403 en la
petición de la LISTA**. Y una docena de pantallas usan este endpoint solo para
rellenar un desplegable de profesionales, y se comen el 403 en silencio: el
filtro de terapeutas de `/pacientes` tiene un plan B que se inventa la lista
con los pacientes que tenga cargados —los 50 de la página, de 1.174—, así que
salía media plantilla y **cambiaba al pasar de página**. Como ese mismo
desplegable asigna terapeuta al dar de alta un paciente, el agujero no solo
escondía: ensuciaba el dato.

Es el **primo hermano** del fallo que cuenta `lib/citas/visibilidad.js`. Allí
preguntar por el usuario DESTAPABA la agenda de otra profesional; aquí esconde
la plantilla hasta romper la pantalla. La regla es la misma en los dos sitios:
«¿existe la tabla / lo tiene el CENTRO?» → `tenantHasModule`; «¿puede esta
persona abrir esa pantalla?» → `hasModule`.

**Lo que NO se tocó**: `POST`/`PATCH`/`DELETE` siguen pidiendo el módulo en los
accesos y rol de dirección, y `GET /api/team/[id]` —que devuelve correo,
teléfono, notas y, para dirección, la retribución— sigue cerrado con
`hasModule`. Lo vigila `scripts/_smoke-team-lista-profesionales.mjs`, que
además falla si el serializer completo gana un campo nuevo sin declarar si
entra o no en el recorte.
## Eventos de auditoría

Todos se registran en `master.AuditLog` con `entity: "TeamMember"`,
`entityId`, IP, y un par `before`/`after` con los campos relevantes:

- `team.created` — al crear un miembro (POST).
- `team.role_changed` — cuando cambia `position` (PATCH).
- `team.cost_changed` — cuando cambia `hourlyCost` (PATCH).
- `team.rate_changed` — cuando cambia `hourlyRate` (PATCH).
- `team.salary_changed` — cuando cambia `monthlySalary` (PATCH, añadido
  en sprint billing).
- `team.status_changed` — cuando cambia `status` (PATCH).
- `team.deactivated` — al hacer DELETE (soft delete).
- `team.deleted` — al borrar la ficha de verdad (`DELETE [id]/borrar`); el
  `before` es un resumen (nombre, puesto, estado), no la fila entera.
- `team.modules_changed` — al cambiar los módulos marcados del miembro
  (PATCH `[id]/modules`; es el espejo informativo, no el acceso).
- `team.user_created`, `team.access_changed`, `team.password_reset`,
  `team.user_removed` — los del login del miembro (ver «Acceso al CRM desde
  Equipo»); el último también salta al dar de baja a alguien con usuario.

El registro de auditoría se hace dentro de un `try/catch` aislado: un
fallo de auditoría no rompe la respuesta principal del endpoint.

## Endpoints

Todos validan `hasModule("team")` antes de operar, salvo los que se indican:
los de autoservicio (`me`, `me/documents`, `[id]/hours`) gatean a nivel de
TENANT con `team` O `clinica`, porque las terapeutas de un centro no llevan
`team` en su `moduleAccess` y aun así tienen ficha y horario (bug del
27/07/2026); `billing-summary` y `[id]/projects` gatean por el módulo que
aporta el contenido.

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/team` | Listado con filtros (`status`, `role`, `q`) y paginación (`limit`, `offset`). Devuelve además `availableRoles` (valores únicos de `position` presentes), `viewerIsAdmin` y `listaReducida`. | **Gate de TENANT** (`tenantHasModule("team")`), no del usuario. Quien no lleve `team` en su `moduleAccess` recibe la **lista recortada** (ver abajo). |
| `POST /api/team` | Crea miembro nuevo. | Solo admin/superadmin. |
| `GET /api/team/[id]` | Detalle. | Cualquier autenticado del tenant. |
| `PATCH /api/team/[id]` | Edita; auditoría granular por campo (ver eventos). | Solo admin/superadmin. |
| `DELETE /api/team/[id]` | **Soft delete**: cambia `status` a `inactive`. NUNCA borrado físico. Idempotente (si ya está inactivo devuelve `204` sin tocar nada). | Solo admin/superadmin. |
| `GET /api/team/[id]/billing-summary` | Resumen de facturación del empleado (ver módulo Billing). | Requiere `hasModule("billing")` (no basta con `team`); cualquier autenticado del tenant, pero `monthlySalary` y `projectedSalaryCost` solo a admin. |
| `GET /api/team/[id]/projects` | Proyectos en los que el miembro figura en `project_members`, con su `memberRole`; presupuesto filtrado por `serializeProject`. | Requiere `hasModule("projects")`. |
| `GET/PUT /api/team/[id]/hours` | Horario semanal PROPIO del miembro (`team_member_hours`: `dayOfWeek` 0–6 + franjas). El PUT es un reemplazo atómico. Lo usa `TeamHoursEditor` en la ficha y en `/mi-horario` (Citas). | Gate de tenant `team` O `clinica`. El admin ve/edita cualquiera; un profesional solo el SUYO. |
| `GET/PATCH /api/team/[id]/modules` | Módulos marcados del miembro (`team_member_modules`, espejo informativo): GET devuelve TODOS los activos del tenant con el flag; PATCH hace upsert e ignora claves que no sean módulos del tenant. NO es el acceso al CRM: eso es `[id]/access`. | Solo admin. |
| `GET /api/team/me` | La ficha de equipo del usuario logueado (autoservicio: Mi horario, `MiEquipo`). Solo campos NO sensibles, nada de retribución. El segmento estático `me` gana al dinámico `[id]`. | Gate de tenant `team` O `clinica`. |
| `GET/POST /api/team/me/documents` · `GET/DELETE /api/team/me/documents/[id]` | Documentación personal que el propio miembro sube en su ficha (CV, titulaciones). Reutiliza el almacén de Documentos (`source: "equipo"`, `ownerUserId` = quien sube) pero **no depende del módulo `documents`**: siempre acotado al dueño, nunca alcanza el archivo general del centro. | Gate de tenant `team` O `clinica`; solo lo propio. |
| `GET /api/team/modules` | Módulos activos del TENANT (para los checkboxes de acceso en el alta). No confundir con `/api/auth/me → enabledModules` (esa es la intersección del usuario actual). | Solo admin (rol fresco de BD). |
| `GET /api/team/[id]/access` | Estado del login del miembro: `{ hasUser, username, lastLoginAt, managedElsewhere, modules }`. Sin usuario, `modules` propone lo marcado en `team_member_modules`. | Solo admin (rol fresco de BD). |
| `POST /api/team/[id]/access` | **Crea el usuario de login** en `master.users` (patrón terapeutas de Aumenta): username sin `@` con sufijo `_{slug}` forzado (o email real), rol según `rol` del cuerpo (`user` por defecto; `admin` desde el 27/08/2026,
y entonces `moduleAccess: ["all"]` y no se piden módulos), `moduleAccess` =
módulos marcados (mínimo 1 salvo admin). `password` **OBLIGATORIA**, validada con `lib/auth/contrasena.js` antes de crear nada; no se devuelve. | Solo admin; nunca en demo; 409 si ya tiene usuario o el username existe. |
| `PATCH /api/team/[id]/access` | Cambia `moduleAccess` (lo que ve al entrar; aplica al instante — el resolver no cachea ACLs). `[]` permitido = bloquear sin borrar. Espeja en `team_member_modules`. | Solo admin; nunca en demo; nunca sobre cuentas admin ni sobre uno mismo. |
| `DELETE /api/team/[id]/access` | Quita el acceso: desenlaza `userId` y borra el User. El token vivo muere en la siguiente request (el resolver falla en cerrado). La ficha del empleado se conserva. | Ídem. |
| `POST /api/team/[id]/access/password` | Restablece la contraseña (bcrypt 12, `tokenVersion++` para tumbar sesiones). `password` **OBLIGATORIA** en el cuerpo, validada con `lib/auth/contrasena.js`; no se devuelve. Ver «La contraseña la escribe SIEMPRE quien la da». | Ídem. |

### Acceso al CRM desde Equipo (2026-07-27)

El alta de logins dejó de ser solo-por-script: la ficha del empleado tiene la
sección **«Acceso al CRM»** (`components/team/AccessSection.jsx`) y el alta un
bloque «Crear usuario para que entre al CRM». La contraseña generada se enseña
una única vez (`components/team/CredentialsModal.jsx`); no hay invitación por
email (Resend es BYOK, no garantizado). Helpers en `lib/team/access.js`.

Decisiones clave:

- **La fuente de verdad de módulos es `master.users.moduleAccess`** (el gate
  real de `hasModule()`); la tabla `team_member_modules` pasó de "config
  informativa" a ESPEJO sincronizado para miembros con usuario, y sigue siendo
  informativa para miembros sin él. La antigua `ModulesSection` decorativa de
  la página fue sustituida por `AccessSection`.
- Estos endpoints leen el rol del solicitante FRESCO de BD (`ctx.user.role`),
  no del header `x-user-role` (JWT, TTL 15 min): escriben en master.
- Guardas: nunca se EDITA una cuenta `admin`/`superadmin` (módulos, contraseña
  ni borrado), nunca uno mismo, nunca desde la demo pública (que da sesión
  admin a anónimos). **Desde el 27/08/2026 sí se puede CREAR un `admin`** — la
  asimetría es la decisión, no un descuido: ver
  `docs/decisions/2026-08-27-alta-de-administradores.md` y la prueba
  `scripts/_smoke-team-roles.mjs`. La red para cuando dentro no queda nadie es
  el back-office (`/admin/clientes` → ficha → Administradores).
- Al **desactivar** un miembro con usuario, la UI encadena primero
  `DELETE .../access` (una baja no deja un login vivo) y avisa si no puede
  (p. ej. cuenta admin).
- Eventos de auditoría: `team.user_created`, `team.access_changed`,
  `team.password_reset`, `team.user_removed` — nunca incluyen la contraseña.
- OJO `scripts/grant-module-access.js`: trata la lista vacía como "sin
  restricciones, no tocar", la semántica CONTRARIA al gate (`[]` = sin
  acceso). No usarlo para cuentas creadas desde Equipo.

Reglas adicionales:

- Filtros de `?status=`: `default` (activos + de baja, comportamiento por
  defecto), `active`, `inactive`, `on_leave`, `all` (sin filtro).
- `?role=` filtra por `position` exacto (no parcial).
- `?q=` busca con `iLike` sobre `displayName` y `email`.
- Orden fijo por `displayName ASC`. No se expone ordenación whitelisted
  todavía.
- Borrado físico **prohibido** para preservar histórico (timetracking,
  asignaciones futuras, auditoría).

### `/api/auth/me`

Aunque pertenece al sub-sistema de autenticación, el endpoint nació en
este sprint y lo usa el frontend de Equipo, Facturación y otros módulos
para gating de admin. Vive en `app/api/auth/me/route.js`.

- Lee `x-user-id` y `x-tenant` de los headers que inyecta el middleware.
- Devuelve `{ id, email, role, tenantId, tenantSlug, tenantName, enabledModules }`.
- `enabledModules` es la intersección entre los módulos activos del
  tenant (`TenantModule.enabled = true`) y `User.moduleAccess`. Si
  `moduleAccess` está vacío o el rol es `superadmin`, devuelve todos los
  activos del tenant.
- Nunca expone `passwordHash` ni `moduleAccess` raw.
- `Cache-Control: no-store` para que el cliente no cachee roles obsoletos.

## Validaciones

- `displayName` obligatorio en POST y no puede ser vacío en PATCH (se
  rechaza si tras `trim()` queda en blanco).
- `email`: regex propia (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) si no es null.
  Strings vacíos o solo whitespace se normalizan a `NULL` antes de
  guardar (varios `NULL` conviven en el UNIQUE; varios `""` lo romperían).
- `email` único en el tenant cuando no es null. La validación se hace a
  mano antes del INSERT/UPDATE para devolver `409` con mensaje claro
  ("Ya existe un miembro con ese email") en vez de propagar el error de
  Sequelize.
- `userId`: si se proporciona, debe corresponder a un `User` que
  pertenezca al tenant actual y que **no** esté ya vinculado a otro
  `TeamMember`. Lo segundo se comprueba con `id != excludeId` en PATCH
  para permitir guardar sin cambios.
- `hourlyCost`, `hourlyRate`, `monthlySalary`: numéricos finitos ≥ 0,
  redondeados a 2 decimales. Se distinguen tres casos: `null` (campo
  borrado), valor válido, o sentinela `undefined` para "valor inválido"
  → respuesta `400`.
- `status`: solo `active`, `inactive`, `on_leave` aceptados.
- DELETE no elimina, sólo cambia `status` a `inactive`.

## Frontend

La página principal del módulo: `app/(dashboard)/equipo/page.jsx`. Listado
en tabla con drawer lateral para detalle / alta / edición (al no admin le
pinta `components/team/MiEquipo.jsx`, su propia ficha). Las ocho pantallas
de `team_avanzado` y la de Fichaje cuelgan de la misma carpeta (ver el Mapa)
y se documentan en `clinica.md` / `citas.md` / `fichaje.md`; aquí solo la
plantilla.

Columnas visibles del listado:

- Empleado (avatar + `displayName` + teléfono pequeño).
- `role`.
- `department`.
- `email`.
- `status` (badge con colores: verde activo / ámbar de baja / gris inactivo).
- `hourlyRate` (siempre).
- `hourlyCost` (solo admin).
- `monthlySalary` (solo admin).

El drawer de detalle muestra `hourlyRate` siempre, y `hourlyCost` y
`monthlySalary` adicionalmente para admin. La sección embebida de
Facturación (`EmployeeBillingSection`) sigue mostrando estos datos
agregados sobre el periodo seleccionado.

Búsqueda por nombre/email con debounce de ~300ms. Filtros: `status` con
las 5 opciones (Activos+de baja por defecto, Activos, Inactivos, De
baja, Todos) y `role` con selector dinámico (los valores únicos
presentes vienen de `availableRoles` en la respuesta del listado, no
hardcodeados).

Acciones:

- Botón **"+ Añadir empleado"** solo visible si `viewerIsAdmin`.
- Click en fila → drawer detalle.
- Botón **"Editar"** dentro del drawer solo admin.
- Botón **"Desactivar"** (admin) con confirmación textual; oculto si el
  empleado ya está `inactive`. Llama al DELETE soft.

El formulario de alta/edición incluye, además de los campos comunes,
los inputs de **`hourlyCost`** y **`monthlySalary`** condicionales a
`viewerIsAdmin`. `monthlySalary` lleva un helper text recordando que
solo lo ven los administradores y que alimenta la analítica de
empleados. `hourlyRate` es visible para cualquier admin (igual que el
resto del form, ya gated por el botón "Editar"). Si el envío llegara
desde un viewer no-admin, los campos sensibles se eliminan del payload
antes del fetch (defensivo: el backend ya restringe POST/PATCH a
admin/superadmin).

`on_leave` en el formulario:

- No es opción nueva del desplegable de status (solo aparecen `active` e
  `inactive`).
- Si el empleado abierto ya tiene `status = "on_leave"`, la opción se
  añade dinámicamente para que se pueda mantener o cambiar a otro estado.
  No es posible poner `on_leave` a alguien que esté activo desde la UI.

El detalle del empleado embebe `components/billing/EmployeeBillingSection.jsx`
(selector trimestre/año), que llama a `/api/team/[id]/billing-summary`.
Si el módulo billing no está activo, la sección se oculta silenciosamente
(la respuesta `403` se interpreta como "no aplicable").

Mobile-first con Tailwind 4. El drawer respeta la regla 13 de CLAUDE.md
(`top-14 lg:top-0 ... bottom-0` para no taparse con la barra del menú
hamburguesa).

## Integraciones con otros módulos

- **Facturación (#5)**: `monthlySalary` alimenta `projectedSalaryCost`
  en `/api/billing/analytics/employees` y
  `/api/team/[id]/billing-summary`. `Invoice.employeeId` y
  `Cost.employeeId` apuntan a `TeamMember`. El drawer de Equipo embebe
  el resumen de facturación del empleado.
- **Auth (User en master)**: vínculo opcional vía `userId`. Un `User`
  puede tener un `TeamMember` asociado, pero un `TeamMember` puede
  existir sin User (externos, subcontratados). Desvincular un
  `TeamMember` del User no afecta al login del User.
- **Audit (master.AuditLog)**: cambios sensibles registrados (ver
  "Eventos de auditoría").
- **Proyectos (#3)**: `project_members` y `task_assignees` apuntan a
  `TeamMember` (`GET /api/team/[id]/projects`). **Soporte (#4)**:
  `Ticket.assignedTo` = `TeamMember.id`. **Citas**: `team_member_hours` y el
  `teamMemberId` de la cita. Planificación (#7) y Comunicaciones (#16)
  también lo necesitarán cuando existan.

## Migración y backfill

Fichero: `scripts/migrate-team-fields.js`. Idempotente. Lee la lista de
schemas desde `master.tenants` **sin filtrar por `status`** (regla 12 de
CLAUDE.md: el estado decide quién entra, no qué forma tiene su schema; el
`WHERE status = 'active'` se barrió el 12/08/2026).

Una sola transacción global para todos los tenants. Para cada schema
`crm_{slug}`:

- Añade columnas que falten en `team_members`: `email`, `hourly_cost`,
  `hourly_rate`, `currency` (NOT NULL DEFAULT `'EUR'`), `notes`.
- Baja `user_id` a `NULL` permitido para soportar empleados sin User.
- Crea índice único `team_members_email_unique` sobre `email`. PG trata
  los `NULL` como distintos por defecto (`NULLS DISTINCT`), así que
  varios miembros sin email coexisten.

`monthlySalary` se añadió **después**, en
`scripts/migrate-billing-rework.js` como parte del rework de Facturación.
Si un tenant nace tras esa migración, ambas se aplican secuencialmente.

`avatarColor` se añadió en una migración independiente
(`scripts/migrate-team-members-avatar-color.js`) tras detectar que Sprint
2 Proyectos lo asumía. A diferencia de `migrate-team-fields.js`, esta
itera sobre **todos los schemas `crm_%`** de `information_schema`, no
sobre `master.tenants`: la columna es transversal y no debe quedar fuera
de ningún schema con tabla `team_members`. El backfill usa
`'#' || SUBSTR(MD5(id::text), 1, 6)` para que el color sea estable por
miembro entre entornos.

Comandos:

```
npm run db:migrate:team             # local
npm run db:migrate:team:prod        # producción
npm run db:migrate:avatar-color     # local (idempotente)
npm run db:migrate:avatar-color:prod # producción (idempotente)
```

## Seed

Fichero: `scripts/seed-team-demo.js`. Comando: `npm run db:seed:team`.
Solo opera sobre el tenant `demo`. Idempotente: hace UPSERT por
`displayName` (si existe lo actualiza, si no lo crea).

Crea/actualiza 5 miembros:

| Nombre | Rol | Departamento | Estado |
| --- | --- | --- | --- |
| Ana García | Empleado Senior | Infantil | active |
| Carlos López | Empleado Senior | Adultos | active |
| Laura Martínez | Empleado Senior | Neuropsicología | active |
| Miguel Sánchez | Empleado Junior | Familia | active |
| Sara Romero | Empleado Junior | Administración | inactive |

Vincula a Ana García al `User` admin del demo (`admin@demo.salamandra`).
Si otro miembro tiene ese `userId`, lo desvincula primero para mantener
la unicidad. Si Ana ya está vinculada, no-op.

`monthlySalary` **no** se asigna en este seed. Se rellena en
`scripts/seed-billing-demo.js` como parte del seed de Facturación
(salarios mensuales de 1.900 € a 2.900 € según el miembro). Ejecutar el
seed de equipo solo deja los empleados con `monthlySalary` en `NULL`.

## El correo de una cuenta — 2026-08-26

**`users.email` no es un correo: es el IDENTIFICADOR con el que se entra.** Las
trece terapeutas de Aumenta entran con `nombre_aumenta`, sin arroba, y por eso
las puertas que crean usuarios llaman a `User.create` con `validate: false`. De
las 30 cuentas de producción, **18 tienen ahí un nombre de usuario** y solo 12 un
correo de verdad; 14 no tenían ninguna dirección en ninguna parte del CRM.

Desde hoy son dos columnas y dos trabajos:

| | |
| --- | --- |
| `email` | CON QUÉ SE ENTRA. Puede no llevar arroba. No se toca. |
| `email_contacto` | A DÓNDE SE LE ESCRIBE. Un correo de verdad, único, y **también sirve para entrar**. |

La regla vive en `lib/auth/correoCuenta.js`, **sin ni un import** —como
`contrasena.js` y por lo mismo: la usa el navegador, así que no puede arrastrar
Sequelize al bundle—. Sus consultas, al lado en `correoCuentaDb.js`.

`correoDeCuenta()` cae a `email` cuando este sí tiene forma de correo: por eso
las 12 cuentas que ya entran con el suyo funcionan sin tocarles una fila.

### En la pantalla

Al crear un acceso se piden **usuario, correo y contraseña**, y el correo se
**propone solo** desde `team_members.email` si la ficha lo tiene. En una cuenta
que ya existe, la ficha enseña su correo con un «cambiar» al lado; si no tiene
—las de antes de hoy pueden no tenerlo— sale un aviso en ámbar con «Ponerle
uno», porque una cuenta que no puede recuperar su contraseña hay que poder
VERLA, no descubrirla el día que alguien se queda fuera. Va por `PATCH` con solo
`correo`, sin tocar los módulos.

### Que se vea quién no lo tiene

La lista de Equipo trae dos cosas nuevas cuando quien mira es dirección:
`cuentasSinCorreo` (el total del CLIENTE, no de la página) para el rótulo de
arriba, y `cuentaSinCorreo` por fila para la marca. Las dos se calculan
best-effort, como `tieneHorario`: si master falla, la lista sale igual, sin la
marca. En la lista recortada no viajan.

Y a la persona se le avisa donde trabaja, no donde se arregla:
`components/layout/AvisoCorreoCuenta.jsx`, montado en `DashboardShell.jsx`
sobre el contenido. Se calla con `sessionStorage` —vuelve mañana— y nunca sale
en las demos.

### Quién puede ponérselo

Un admin, a cualquiera, desde Equipo. **Pero no a una cuenta de administrador ni
a la suya** —`loadManagedUser` las rechaza a propósito—, así que el
administrador único de un cliente se quedaba sin sitio. Para eso está
**Configuración → Tu cuenta → «El correo de tu cuenta»**
(`app/api/auth/correo/route.js`): cada uno el suyo, con los mismos frenos que el
cambio de contraseña y **pidiendo la contraseña**, porque el correo también sirve
para entrar.

### La puerta que no se puede rodear

La exigencia NO está en los formularios: está en un hook `beforeCreate` de
`models/master/User.model.js`, por debajo de las tres puertas, de los seeds y de
cualquier script futuro. Es un hook y no una `validate` porque las puertas crean
con `validate: false` a propósito. **Solo al crear**: un `beforeSave` tumbaría a
las 14 cuentas sin correo en cuanto entraran, porque el login les escribe
`lastLoginAt`.

### Cuidado si tocas el login

Una cuenta tiene ahora DOS identificadores, y eso toca dos cosas delicadas:

- **Cuando algo empata, manda `email`** (`elegirCuenta`). Mientras el
  identificador gane, un `email_contacto` mal metido no puede desviar el login
  de otra persona hacia otra cuenta.
- **Dos identificadores NO son el doble de intentos.** El cerrojo cuenta por lo
  que se teclea (corre antes de tocar la base), así que alternar los dos daría
  12 intentos en vez de 6. El login, ya sabiendo a quién señalaba, vuelve a
  preguntar por el canónico (`cerrojoDeCuenta`) y apunta el fallo en los dos
  cubos —el segundo con `barrido: false`, para no contar dos veces en el cubo de
  la IP que protege a las quince personas de Aumenta—.

Todo esto está fijado en `scripts/_smoke-correo-cuenta.mjs`. El porqué entero,
en `../decisions/2026-08-26-el-correo-de-una-cuenta-no-es-su-usuario.md`.
## Actividad (registro legible) — 2026-07-27

`/equipo/actividad` (hijo adminOnly del grupo Equipo con `moduleKey:
"team_avanzado"` en el Sidebar; nació sin moduleKey heredando team|clinica y
pasó al avanzado cuando se vendió aparte) enseña master.audit_logs del tenant
en frases legibles, agrupado por días, con filtros por módulo, usuario y rango
(7/30/90 días). Piezas: `GET /api/actividad` (solo admin, rol fresco de BD, y
`hasModule("team_avanzado")`; máx. 400 filas por consulta) + catálogo de etiquetas
`lib/actividad/etiquetas.js` (acción → { modulo, texto }; las acciones nuevas
caen en un traductor genérico, nunca salen en crudo — al añadir una acción de
AuditLog, añade su frase al catálogo). Índice de apoyo en master:
`scripts/migrate-audit-logs-index.js` (ONE_OFF, se corre a mano; la tabla no
tenía ninguno). Limitación conocida: solo aparece lo que ya se audita — el CRUD
de clients/leads/billing-pagos/inventario/orders/tickets no audita todavía.

## Backlog

- Vacaciones / ausencias (uso real del estado `on_leave` con fechas y
  motivos).
- Contratos / nóminas.
- Capacity planning / carga de trabajo.
- Organigrama visual.
- Página detalle como ruta propia `/equipo/[id]` para permalinks
  compartibles (hoy solo drawer).
- Sweep en `scripts/db-sync.js` para que la UPSERT de `tenant_modules`
  active automáticamente módulos nuevos en tenants existentes (hoy hay
  que hacer un UPDATE manual cuando se añade un módulo al catálogo).

## Incoherencias resueltas

- **`monthlySalary` ahora editable desde el formulario** (resuelto en el
  mini-fix posterior a esta documentación). El form de alta/edición
  incluye un input numérico gated a admin/superadmin con helper text;
  la columna y el `DetailRow` correspondientes también se mostraron
  para admin. La API ya lo aceptaba; lo único que faltaba era la UI.
