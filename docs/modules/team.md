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
| **Pantallas** | `team`: `/equipo` → `app/(dashboard)/equipo/page.jsx` (plantilla, drawer de alta/edición, horario, «Acceso al CRM»; al no admin le pinta `MiEquipo`) · `team_avanzado`: `/equipo/mi-desempeno`, `/equipo/desempeno-config`, `/equipo/direccion`, `/equipo/productividad`, `/equipo/incidencias`, `/equipo/bandeja` (con `clinica`), `/equipo/ocupacion` (con `citas`), `/equipo/actividad` → `app/(dashboard)/equipo/<carpeta>/page.jsx`, con sus piezas en `app/(dashboard)/equipo/_components/` · `fichaje`: `/equipo/fichaje` · el grupo del menú se ve con `team` O `clinica` (`visibleModules`) |
| **Endpoints** | `app/api/team/**` — 12 `route.js`: `route.js` (listado/alta), `[id]` (detalle, edición, baja lógica), `modules` y `[id]/modules`, `[id]/access` (+ `password`: el login del miembro, escribe en `master.users`), `[id]/hours` (horario), `me` y `me/documents` (+ `[id]`) (autoservicio; gate `team` O `clinica` a nivel de tenant), `[id]/billing-summary` (gatea `billing`), `[id]/projects` (gatea `projects`) · `team_avanzado` — 18 `route.js` con `hasModule("team_avanzado")`: `app/api/actividad`, `app/api/clinica/performance/**`, `app/api/clinica/productividad/**`, `app/api/clinica/incidencias/**`, `app/api/clinica/incentive-items/**`, `app/api/clinica/dashboard`, `app/api/clinica/bandeja` y `app/api/citas/informe-ocupacion` · `app/api/auth/me` (`enabledModules`) · Públicos: ninguno |
| **Lógica** | `lib/team/`: `serializeTeamMember.js` (BD → API; oculta coste y salario a quien no es admin) · `access.js` (crear, cambiar y quitar el login y su `moduleAccess`) · `currentTeamMember.js` (qué `TeamMember` es el usuario logueado) · Actividad: `lib/actividad/etiquetas.js` (acción de auditoría → frase) · las pantallas avanzadas tiran de `lib/clinica/` |
| **UI** | `components/team/`: `AccessSection.jsx` («Acceso al CRM»), `CredentialsModal.jsx` (la contraseña una sola vez), `TeamHoursEditor.jsx` (horario; también en `/mi-horario`, de Citas), `MiEquipo.jsx` (mini-módulo del no admin) · `components/billing/EmployeeBillingSection.jsx` embebido en la ficha · no hay `modules/team/` |
| **Modelos** | `TeamMember` (`team_members`), `TeamMemberHours` (`team_member_hours`), `TeamMemberModule` (`team_member_modules`, espejo informativo de `moduleAccess`); en `master`: `User` (`users`; `module_access` es la segunda puerta) y `AuditLog` (`audit_logs`, lo que lee Actividad) · `team_avanzado` lee modelos de Clínica y Citas: `PerformanceMetric`, `IncentiveItem`, `Incidencia`, `IncidenciaAssignee`, `Booking` |
| **Interruptores y parámetros** | ninguno que lea el código (ni `featureFlags` ni `logicOverrides`); lo que decide es el rol (fresco de BD en `access`), `visibleModules: ["team", "clinica"]` y `requiresAll` de `components/layout/Sidebar.jsx`, y `users.module_access` |
| **Pantallas propias** | ninguna (letrero `ui_override` vacío en producción) |
| **Scripts** | activar: `node scripts/enable-module.js <slug> team` (y `team_avanzado`); `MODULES.team` de `scripts/_module-migrations.js`: `migrate-team-fields`, `migrate-rename-therapist-to-employee`, `migrate-team-modules-salary`, `migrate-team-members-avatar-color`, `migrate-team-specialties`, `migrate-team-weekly-hours`, `migrate-team-member-hours` (+ CORE `migrate-team-members-block-color`); lo de `team_avanzado` va en `MODULES.clinica` (`migrate-incidencias-module`, `migrate-incentive-items`, `migrate-clinica-performance-roles`) · seeds: `seed-team-demo.js` (`npm run db:seed:team`), `_hechos/seed-aumenta-equipo-real.js` (el equipo real de Aumenta, 24/07/2026: no relanzar) · accesos: `check-module-access.js` (`npm run db:check-access`), `grant-module-access.js` (ojo: `[]` = «no tocar», al revés que el gate) · Actividad: `migrate-audit-logs-index.js` (master, ONE_OFF ya corrido), `podar-audit-logs.js` (retención) · `npm run db:check-links` (`team_member_id` en `plans`, `interactions`, `client_notes`…) |
| **Pruebas** | `scripts/_smoke-actividad-etiquetas.mjs` (`node:test`, 19/08/2026, en `npm test`): `lib/actividad/etiquetas.js` —las frases, el traductor genérico, módulos y prefijos— y un CRUCE que lee todos los `action: "x.y"` de `app/api` y `lib` y exige frase propia (el 19/08 faltaban 21 y ganaron la suya ese día; `DEUDA_CONOCIDA` está vacía): una acción nueva sin frase pone la prueba en rojo; y que ningún prefijo con frase caiga en «Otros» (el filtro «Configuración» buscaba `tenant.*` y se escribe `configuracion.*`) · las que nombran `TeamMember` son de Citas (`_smoke-horario-profesional.mjs`, `_smoke-bloqueos-quien-ve.mjs`, `_smoke-citas-sin-profesional.mjs`) |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-07-28-repaso-de-seguridad.md` (el rol fresco de `withTenant`, de lo que viven los endpoints de `access`) · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` |
| **En este doc** | Modelos · Filtrado de campos sensibles · Eventos de auditoría · Endpoints · Frontend · Migración y backfill · Actividad (registro legible) — 2026-07-27 |

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
| `weeklyDirectHours` | INTEGER nullable, 0–80 | Horas objetivo de intervención directa por semana: el denominador de la productividad (`lib/clinica/productivity.js`, `/equipo/productividad`). `NULL` = sin objetivo → productividad N/D. **No pasa por el serializer**: lo escribe `PUT /api/clinica/productividad/hours` (`team_avanzado` + clínica) y lo lee la consulta de productividad. Migración: `migrate-team-weekly-hours.js`. |

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
y deja el resto siempre visible (incluidos `blockColor`, `specialties` y
`specialtyLabels`; `weeklyDirectHours` no sale por aquí). Usar **siempre**
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


### La contraseña la puede escribir quien la da (26/08/2026, Lau)

Restablecer una contraseña desde Equipo daba siempre una aleatoria de 12
caracteres. Sobre el papel es lo más seguro; en un centro de 16 personas donde
la dirección las restablece por teléfono, `k3Jq_8vTz2Lm` se dicta mal, se copia
peor y acaba en un papel encima del monitor. Es la misma conclusión que ya
estaba escrita en `lib/auth/contrasena.js` para «cambiar mi contraseña»: lo que
hace fuerte a una contraseña es el LARGO, no que sea impronunciable.

`POST /api/team/[id]/access` y `POST /api/team/[id]/access/password` aceptan
ahora un `password` **opcional** en el cuerpo. **Sin él todo funciona como
antes**: se genera, se devuelve una vez y se enseña en el modal.

Las cuatro cosas que lo sujetan, y que fija
`scripts/_smoke-team-contrasena-elegida.mjs`:

1. **Las reglas son las MISMAS** que las de `/api/auth/password`, porque es la
   misma función: `revisarContrasena` de `lib/auth/contrasena.js`. Mínimo 10
   caracteres, tope de 72 **bytes** (el de bcrypt, que descarta el resto en
   silencio), y fuera lo que se adivina en los primeros intentos.
2. **Se comprueba contra el usuario de quien RECIBE** la contraseña, no contra
   el de quien la escribe. `elena_aumenta` es mala contraseña para Elena,
   aunque quien la teclee sea la dirección.
3. **Una contraseña elegida no vuelve por la red.** La respuesta trae
   `password: null` y `elegida: true`; la pantalla enseña la que acaba de
   teclearse. La generada sí vuelve, una vez, porque si no nadie la sabría.
   Ninguna de las dos entra en la auditoría: el resumen guarda `elegida`, que
   es lo que hace falta para entender un incidente después.
4. **Las guardas de siempre siguen enteras**: solo dirección con rol fresco de
   BD, nunca cuentas admin ni la propia (`loadManagedUser`), nunca en la demo,
   bcrypt 12 rondas y `tokenVersion +1` para tumbar las sesiones vivas.

En la pantalla el campo va en **texto visible**, a propósito: quien la escribe
se la va a dictar a la persona, y con puntitos no hay forma de ver una errata.

⚠️ **De camino apareció un agujero que era de antes.** `1234567890` se aceptaba
como contraseña —también en «cambiar mi contraseña», desde que se escribió el
fichero—: la lista de tiradas de teclas guardaba `0123456789`, pero la fila del
teclado va `1234567890`, y ni la tira ni su reverso contienen esa rotación.
Arreglado poniendo el `0` a los dos lados (`01234567890`), con su caso en
`_smoke-contrasena.mjs`.
### La lista recortada: «quién trabaja aquí» no es «qué cobra quién» (26/08/2026)

`GET /api/team` tiene **dos puertas**, y confundirlas rompió una pantalla:

| La pregunta | Con qué se contesta | Qué devuelve |
| --- | --- | --- |
| ¿Tiene el **CENTRO** equipo? | `tenantHasModule("team")` | Si no: 403, como siempre. |
| ¿Puede **esta persona** abrir la pantalla de Equipo? | `hasModule("team")` | Si no: `serializeProfesional` — `id`, `userId`, `displayName`, `role`, `status`, `avatarUrl`, `avatarColor`, `blockColor`, `specialties`, `specialtyLabels` y `tieneHorario`. **Nada más.** |

Fuera de la lista recortada, declarado en `CAMPOS_FUERA_DE_LA_LISTA`
(`lib/team/serializeTeamMember.js`): `email`, `phone`, `notes`, `department`,
`startDate`, `hourlyRate`, `currency`, `hourlyCost`, `annualGross`,
`paymentPeriods`, `monthlySalary`. El buscador `q` tampoco mira el correo
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
| `POST /api/team/[id]/access` | **Crea el usuario de login** en `master.users` (patrón terapeutas de Aumenta): username sin `@` con sufijo `_{slug}` forzado (o email real), rol `user`, `moduleAccess` = módulos marcados (mínimo 1). `password` es OPCIONAL: sin él se genera una y se devuelve UNA única vez; con él se valida y **no se devuelve** (ver «La contraseña la puede escribir quien la da»). | Solo admin; nunca en demo; 409 si ya tiene usuario o el username existe. |
| `PATCH /api/team/[id]/access` | Cambia `moduleAccess` (lo que ve al entrar; aplica al instante — el resolver no cachea ACLs). `[]` permitido = bloquear sin borrar. Espeja en `team_member_modules`. | Solo admin; nunca en demo; nunca sobre cuentas admin ni sobre uno mismo. |
| `DELETE /api/team/[id]/access` | Quita el acceso: desenlaza `userId` y borra el User. El token vivo muere en la siguiente request (el resolver falla en cerrado). La ficha del empleado se conserva. | Ídem. |
| `POST /api/team/[id]/access/password` | Restablece la contraseña (bcrypt 12, `tokenVersion++` para tumbar sesiones). `password` OPCIONAL en el cuerpo: sin él se genera y se devuelve una única vez; con él se valida con `lib/auth/contrasena.js` y **no se devuelve** (`elegida: true`). Ver «La contraseña la puede escribir quien la da». | Ídem. |

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
- Guardas: nunca cuentas `admin`/`superadmin` (se gestionan por script), nunca
  uno mismo, nunca desde la demo pública (que da sesión admin a anónimos).
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
