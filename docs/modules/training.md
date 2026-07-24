# Módulo de Formación & Conocimiento (`training`)

> Documentación de detalle. Referencia rápida en `CLAUDE.md` (sección
> "Módulos del CRM"). Si encuentras una discrepancia con el código,
> prevalece el código: actualiza este fichero.

## Visión general

Gestión de la oferta formativa: catálogo de cursos, alumnos privados
(B2C) y de empresa (B2B), matrículas y resultados de cuestionarios.
Implementado para el tenant `retorika` (academia online de comunicación
política, branding y formación educativa) y reutilizado parcialmente
en el demo. El CRM **no genera contenido formativo**: actúa como espejo
analítico de un site WordPress + TutorLMS + WooCommerce.

Es el módulo del CRM con **más integraciones externas** y, a la vez, el
que más superficie de ataque tiene: cinco webhooks públicos firmados
con HMAC, tres endpoints externos protegidos con API key, dos endpoints
sin auth llamados desde el WordPress de Retorika.

## Lo que NO hace (por ahora)

Confirmado leyendo el código:

- **No genera certificados PDF**. `Training.certificateUrl` es un
  STRING libre que se rellena a mano (y en la práctica casi no se usa).
- **No envía recordatorios automáticos** a alumnos.
- **No sincroniza CRM → TutorLMS**. La sincronización es unidireccional
  WP → CRM (vía webhooks o pull en `/api/cuestionarios/sync`). Si un
  admin crea/edita un curso en `/api/training/courses`, los cambios no
  se propagan a WordPress.
- **No genera reportes B2B** para enviar a la empresa cliente
  (informes de progreso, tasa de aprobados, etc.). La página
  `/formacion/empresas/[id]` solo muestra el listado de cursos
  asignados.
- **No registra eventos en `master.AuditLog`**. Crear/editar cursos,
  empresas, alumnos o matrículas es silencioso.
- **No tiene rate limiting** en webhooks ni en endpoints externos.

## Integraciones externas

Es la sección crítica. Resumen en una tabla:

| Sistema externo | Dirección | Endpoint | Auth | Estado |
| --- | --- | --- | --- | --- |
| TutorLMS (WordPress) | WP → CRM | `POST /api/webhooks/tutorlms/course` | HMAC SHA256 | Producción |
| TutorLMS | WP → CRM | `POST /api/webhooks/tutorlms/enrollment` | HMAC SHA256 | Producción |
| TutorLMS | WP → CRM | `POST /api/webhooks/tutorlms/quiz-attempt` | HMAC SHA256 | Producción |
| TutorLMS | WP → CRM (bulk) | `POST /api/webhooks/tutorlms/sync` | HMAC SHA256 | Producción |
| TutorLMS | WP → CRM (bulk) | `POST /api/webhooks/tutorlms/sync-courses` | HMAC SHA256 | Producción |
| TutorLMS | CRM → WP (pull) | `POST /api/cuestionarios/sync` | JWT + Basic Auth WP | Producción |
| WooCommerce | indirecta | `Course.wcProductId` | — | Solo lookup |
| WordPress (web pública) | WP → CRM | `GET /api/cursos-empresas/codigos-cursos/:email` | Header `x-tenant`, sin secret | Producción |
| WordPress (web pública) | WP → CRM | `POST /api/usuarios/register/empresa` | Header `x-tenant`, sin secret | Producción |
| Externo (paneles propios) | externo → CRM | `GET /api/external/retorika/alumnos[/:email]` | API key (`RETORIKA_API_KEY`) | Producción |
| Externo | externo → CRM | `GET /api/external/retorika/cursos` | API key | Producción |

### WordPress + TutorLMS (webhooks entrantes)

Cinco endpoints en `app/api/webhooks/tutorlms/*`, todos con la misma
estructura: leer el body crudo, validar HMAC, parsear JSON, resolver
tenant (vía header `x-tenant` o subdominio; no JWT), persistir.

**Validación HMAC**: helper compartido `lib/training/webhookAuth.js`.
Lee `process.env.CRM_WEBHOOK_SECRET` en runtime (nombre canónico desde
2026-07-24; el legacy `RETORIKA_WEBHOOK_SECRET` se acepta como fallback),
falla ruidoso si no está configurado y devuelve `false` ante cualquier firma.
En los WordPress conectados el define de wp-config.php usa el MISMO nombre:
`define('CRM_WEBHOOK_SECRET', '...')`.

```js
import { verifyHmacSignature } from "lib/training/webhookAuth.js";
if (!verifyHmacSignature(rawBody, signatureHeader)) return 401;
```

Header esperado: `X-Retorika-Signature` (acepta tanto `sha256=<hex>`
como `<hex>` sin prefijo). Si la verificación falla → `401 "Firma
inválida"`. Si `timingSafeEqual` lanza por longitudes distintas, se
captura y devuelve `false`.

Los cinco endpoints en detalle:

- **`POST /course`**: acción `publish`/`update`/`delete` sobre un
  `Course`. UPSERT por `wpCourseId`. `delete` solo desactiva
  (`active = false`), no borra.
- **`POST /enrollment`**: matrícula individual. Crea o reutiliza
  `TrainingUser` (siempre `type: "private"`, sin `companyId`) y
  `Course` por `wpCourseId`, y un `CourseEnrollment` idempotente.
- **`POST /quiz-attempt`**: intento de cuestionario en tiempo real.
  Idempotente por `wpAttemptId` con UPDATE / INSERT explícito en SQL
  raw (porque `answers` es JSONB y Sequelize tenía problemas de cast).
  Conserva el JSONB completo de respuestas pregunta-a-pregunta.
- **`POST /sync`**: array de matrículas. Bulk de `processEnrollment`
  con contadores `imported`/`skipped` (los errores por ítem solo
  incrementan `skipped` sin propagar).
- **`POST /sync-courses`**: array completo de cursos activos en WP.
  Hace upsert de cada uno y **desactiva los cursos del CRM que no
  aparezcan en el array**. Útil para reconciliar tras cambios masivos.

Tras validar HMAC y resolver tenant, los cinco webhooks comprueban
`ctx.hasModule("training")`; si el módulo no está activo en ese
tenant, devuelven `403` antes de cualquier escritura.

### TutorLMS (pull desde el CRM)

`POST /api/cuestionarios/sync` invierte la dirección: el admin pulsa
"sincronizar" en la UI, el CRM llama a la REST API de WordPress
(`/wp-json/tutor/v1/quiz-attempts`) con Basic Auth y trae los intentos
en bulk. Útil para backfills (los webhooks solo cubren los intentos
nuevos).

Credenciales en variables de entorno: `WP_URL`, `WP_API_USER`,
`WP_API_KEY`. **Aquí sí está bien** (env var, no hardcoded).
Contraste claro con el secret HMAC.

Para cada intento listado, opcionalmente hace una segunda llamada
`/quiz-attempts/{id}` para obtener el detalle completo (preguntas y
respuestas). Mapea formato TutorLMS → formato interno y hace
`QuizAttempt.upsert` por `wpAttemptId`.

Errores por intento se acumulan en `errors[]` sin abortar el bulk.

### WooCommerce

Integración mínima. `Course.wcProductId` (INTEGER) guarda la referencia
al producto WooCommerce que vende ese curso. Se usa principalmente para:

- `GET /api/cursos-empresas/codigos-cursos/:email` → array plano de
  `wcProductId` que el plugin de WP consulta para autorizar acceso al
  contenido.
- `POST /api/usuarios/register/empresa` → devuelve `product_ids` con
  los cursos contratados por la empresa del alumno.

No hay sync directa CRM ↔ WooCommerce. WooCommerce comparte el plugin
con TutorLMS y el `wc_product_id` viene en los webhooks de cursos.

## Flujo end-to-end de pre-aprobación de usuarios empresa

El flujo B2B de Retorika tiene 5 actores: admin del CRM, importador
Excel, alumno empresa, WordPress (formulario público) y CRM. La
secuencia canónica (desde el sprint Fase 1 de junio 2026) es:

1. **Admin crea empresa.** `POST /api/training/companies` con
   `{ name, externalId? }`. Inserta en `companies`.
2. **Admin asigna cursos a la empresa.** `POST /api/training/companies/[id]/courses`
   con `{ courseId }`. Inserta en `company_courses` (pivot
   empresa↔curso). Idempotente por `UNIQUE (company_id, course_id)`.
   - Variante con propagación a empleados ya activos:
     `?propagateToActive=true` añade además una fila en
     `course_enrollments` por cada `TrainingUser` con
     `companyId = id`, `type = "company"`, `active = true`. Útil cuando
     una empresa contrata un curso nuevo y se quiere que sus empleados
     existentes lo vean en el siguiente login.
3. **Admin importa Excel de empleados.** `POST /api/training/users/import`.
   Cada fila con `Empresa` reconocida se crea como
   `TrainingUser { type: "company", active: false, companyId }`. Las
   filas sin empresa siguen siendo `type: "private", active: true` (no
   pasan por este flujo). El default `active=false` es lo que marca
   "pre-aprobado pero pendiente del primer login en WP".
4. **Empleado entra al formulario público de WP** y envía su email.
   El plugin de Retorika llama a `POST /api/usuarios/register/empresa`
   con `x-tenant: retorika`.
5. **CRM activa al empleado y materializa las matrículas.** En una
   transacción única:
   - `UPDATE training_users SET active = true WHERE id = X`.
   - `findOrCreate` por cada `(trainingUserId = X, courseId)` en
     `company_courses` de su empresa → inserta filas en
     `course_enrollments` con `metadata.source = "register_empresa"` y
     `metadata.activatedAt`. Si la transacción falla en cualquier
     paso, ambos cambios se revierten — el flag `active` y las
     matrículas quedan siempre coherentes.
   - Devuelve `{ exists: true, name, normalized, product_ids }` con
     los `wcProductId` de los cursos contratados.
6. **WP crea el WP_User y la orden WooCommerce** con esos
   `product_ids`. WooCommerce dispara el webhook
   `POST /api/webhooks/tutorlms/enrollment` por cada producto. El
   webhook hace `findOrCreate` sobre la misma constraint
   `(trainingUserId, courseId)`, así que **no duplica** las filas
   creadas en el paso 5 — solo enriquece la metadata si ya existían.

### Sincronización `company_courses` ↔ `course_enrollments`

Las dos tablas tienen significados distintos y la confusión histórica
era pensar que una sustituía a la otra:

- **`company_courses`**: el **contrato comercial** empresa↔CRM. "La
  empresa A ha pagado por los cursos X, Y, Z." Un INSERT aquí no le da
  acceso a nadie por sí solo; es el "scope" de qué tiene derecho a
  recibir cualquier empleado de esa empresa.
- **`course_enrollments`**: la **fuente de verdad** de qué cursos
  tiene matriculados un alumno concreto. Un INSERT aquí es lo que
  realmente abre el contenido en WP. Lo que mira
  `GET /api/cursos-empresas/codigos-cursos/:email` para autorizar.

La materialización `company_courses → course_enrollments` ocurre en
dos puntos:

- **Push del lado WP** cuando llega un webhook de enrollment de
  TutorLMS (sucede cuando WooCommerce procesa la orden creada en el
  paso 6 del flujo).
- **Pull del lado CRM** cuando `register/empresa` activa al usuario
  (paso 5 — añadido en Fase 1). Esto cubre el caso de empleados con
  matrículas pendientes antes incluso de que llegue el webhook de WP.

Para los empleados ya activos cuando se asigna un curso nuevo a la
empresa, usar `POST /api/training/companies/[id]/courses?propagateToActive=true`.

`GET /api/cursos-empresas/codigos-cursos/:email` y
`POST /api/usuarios/register/empresa` devuelven, ambos, conjuntos
basados en `wcProductId`, pero no necesariamente coincidentes:

- `register/empresa` mira `company.courses` (contrato): devuelve los
  cursos que se le van a crear al alumno.
- `codigos-cursos/:email` mira `course_enrollments` del alumno
  (matrícula real): devuelve los cursos a los que tiene acceso ahora
  mismo.

Tras el flujo Fase 1, ambos vuelven el mismo conjunto **tras el paso
5** (activación). La divergencia previa al paso 5 (alumno
pre-aprobado pero no activo) es deliberada: hasta que no entra,
`course_enrollments` está vacío y la API pública devuelve `[]`.

### Endpoints externos públicos (sin JWT)

Cuatro rutas que no pasan por el middleware (porque están listadas
como public en `middleware.js` o no requieren cookie):

| Ruta | Auth alternativa | Rate limit | Riesgo |
| --- | --- | --- | --- |
| `GET /api/external/retorika/alumnos` | API key `x-api-key` | No | Bajo (key en env). Devuelve **todos los alumnos** del tenant retorika. |
| `GET /api/external/retorika/alumnos/:email` | API key | No | Bajo. |
| `GET /api/external/retorika/cursos` | API key | No | Bajo. |
| `GET /api/cursos-empresas/codigos-cursos/:email` | Solo header `x-tenant` | 30/min por IP (key `cursos-empresas-codigos`) | **Medio**. Permite enumerar emails y mapear `wcProductId` por alumno. Sin auth. |
| `POST /api/usuarios/register/empresa` | Solo header `x-tenant` | 30/min por IP (key `usuarios-register-empresa`) | **Medio**. Permite enumerar emails de tipo `company` (distingue 403 vs 200) y activar el flag `active` sin más validación que el email. CORS abierto. |
| `POST /api/webhooks/retorika/check-empresa-user` | `x-tenant: retorika` + Origin/Referer en `{asesoriaretorika.com, www.asesoriaretorika.com}` | 30/min por IP (key `retorika-check-empresa-user`) | **Bajo**. Devuelve un único booleano (`isEmpresaInactive`), sin nombre, empresa ni IDs. La superficie de enumeración es igual a la de intentar el registro privado a saco. Sin HMAC porque el snippet WP vive en `code-snippets` público; el secret no puede llegar al browser. |

Los tres primeros tienen `const SLUG = "retorika"` hardcodeado:
ignoran cualquier `x-tenant` que llegue y consultan siempre la BD del
tenant `retorika`. Aceptable como MVP cliente único; no escala si en
el futuro otro tenant quiere API externa con el mismo formato.

**Rate limiting**: los dos endpoints sin auth (`codigos-cursos` y
`register/empresa`) llevan el helper `lib/utils/rateLimit.js` con
límite 30 req/min por IP (X-Forwarded-For + fallback). Compartido con
el resto de `/api/public/*`. Cuando una IP supera el umbral devuelve
HTTP 429 con `Retry-After` y se loguea `[rate-limit] BLOQUEADO ip=...
key=... retry_after=...s` para detectar abusos. Los endpoints
`/api/external/retorika/*` quedan fuera porque están protegidos por
API key y los consume el panel propio de Retorika con cron — añadir
rate limit ahí podría romper sus batches legítimos.

## Modelos

Siete modelos en `models/tenant/`. Asociaciones en
`lib/db/tenantDb.js:99-111`.

### Course

Tabla: `courses`. Catálogo de cursos.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `wpCourseId` | INTEGER nullable | ID del post en WordPress (TutorLMS). Permite UPSERT desde webhooks. |
| `wcProductId` | INTEGER nullable | ID del producto en WooCommerce. |
| `name` | STRING NOT NULL | |
| `active` | BOOLEAN | Soft delete vía webhook `course delete`. |

Asociaciones:

- `Course.belongsToMany(Company, through: CompanyCourse, as: "companies")`.
- `Course.belongsToMany(TrainingUser, through: CourseEnrollment, as: "enrolledUsers")`.

Borrado: `Course.destroy()` es hard delete. Si el curso tiene
matrículas, las foreign keys de `CourseEnrollment.courseId` (sin
`ON DELETE CASCADE`) bloquean la operación con error de constraint.

### CourseEnrollment

Tabla: `course_enrollments`. Matrícula real de un alumno en un curso.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `trainingUserId` | UUID NOT NULL FK | |
| `courseId` | UUID NOT NULL FK | |
| `companyId` | UUID nullable FK | Solo informativo: si el alumno es de empresa, replica `TrainingUser.companyId` aquí. Permite filtrar matrículas por empresa sin doble JOIN. |
| `enrolledAt` | DATE | Default `NOW`. |
| `externalRegistrationId` | INTEGER nullable | ID de la matrícula en WordPress, si lo hubiese. Hoy no se rellena desde webhooks. |
| `metadata` | JSONB default `{}` | Habitualmente `{ source: "tutorlms_webhook", wpUserId }`. |

**UNIQUE** sobre `(trainingUserId, courseId)`: un alumno solo puede
tener una matrícula activa por curso. `findOrCreate` lo aprovecha para
ser idempotente.

### Company

Tabla: `companies`. Empresa cliente del módulo formación. **No
confundir con `Client`**, que vive en otro módulo y representa el
cliente comercial general del CRM.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `name` | STRING NOT NULL | |
| `externalId` | INTEGER nullable | ID externo (TutorLMS, WooCommerce o ERP). Sin restricción de unicidad. |
| `active` | BOOLEAN | |
| `settings` | JSONB | Bolsa libre. Hoy sin uso. |

**Por qué hay dos modelos `Client` y `Company`**: el módulo formación
nació antes que el módulo de clientes/cuentas. Cuando se diseñó el
modelo de `Client` (módulo #1) se decidió no fusionar para no romper
el flujo de Retorika. Hoy son entidades separadas sin relación FK.
Una `Company` puede compartir nombre con un `Client` pero no están
enlazados — el equivalente B2B de Formación es propio del módulo.
Candidato a unificar a futuro pero pendiente.

Asociaciones:

- `Company.hasMany(TrainingUser, as: "trainingUsers")`.
- `Company.belongsToMany(Course, through: CompanyCourse, as: "courses")`.

### CompanyCourse

Tabla: `company_courses`. Pivot many-to-many empresa ↔ curso. Indica
qué cursos tiene **contratados** una empresa (no qué cursos están
matriculados sus alumnos — eso es `CourseEnrollment`).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `companyId` | UUID NOT NULL FK | |
| `courseId` | UUID NOT NULL FK | |

UNIQUE sobre `(companyId, courseId)`. Sin metadata adicional —
contratos, fecha de alta, etc. quedan como extensión futura.

### TrainingUser

Tabla: `training_users`. Alumno. Distinto del `User` de master (que
modela usuarios del CRM con login).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `companyId` | UUID nullable FK | Vacío para alumnos `private`. |
| `externalUserId` | INTEGER nullable | ID en WordPress. |
| `type` | ENUM `private` / `company` | Default `private`. Discrimina B2C de B2B. |
| `username` | STRING nullable | Username de WordPress. |
| `email` | STRING NOT NULL UNIQUE | Validado `isEmail`. **Hook**: `beforeSave` lo normaliza a lowercase + trim. Índice único `training_users_email_unique` creado por `migrate-training-fields.js`. |
| `name`, `lastName` | STRING nullable | |
| `birthDate`, `country`, `nif` | nullable | Datos personales. |
| `active` | BOOLEAN | El flag se usa en `/api/usuarios/register/empresa` como gate de activación al primer login en WP. |

Asociaciones:

- `TrainingUser.belongsTo(Company, as: "company")`.
- `TrainingUser.belongsToMany(Course, through: CourseEnrollment, as: "enrolledCourses")`.

### QuizAttempt

Tabla: `quiz_attempts`. Resultado de un intento de cuestionario en
TutorLMS.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `wpAttemptId` | INTEGER NOT NULL UNIQUE | Clave para idempotencia de webhooks. |
| `wpQuizId`, `wpCourseId`, `wpUserId` | INTEGER NOT NULL | IDs del lado WordPress. |
| `studentName`, `studentEmail` | STRING nullable | Snapshot al momento del intento. |
| `quizTitle`, `courseTitle` | STRING nullable | Idem. |
| `empresa` | STRING nullable | Texto libre. Lo manda TutorLMS si configuró ese campo. |
| `attemptDate` | DATE nullable | |
| `totalQuestions`, `correctAnswers`, `incorrectAnswers` | INTEGER | |
| `totalPoints`, `earnedPoints`, `passingPoints` | DECIMAL(10,2) | |
| `quizTime`, `attemptTime` | INTEGER | Segundos. |
| `result` | ENUM `pass` / `fail` | |
| `answers` | JSONB array | Detalle pregunta a pregunta: `{ no, questionId, type, question, givenAnswer, correctAnswer, isCorrect, marks }`. Se trunca a `attributes: { exclude: ["answers"] }` en el listado para no inflar respuestas. |

Solo se modifica vía webhook (`/quiz-attempt`) o pull (`/cuestionarios/sync`).
**No hay PATCH ni DELETE públicos**.

### Training

Tabla: `trainings`. Modelo legacy del primer diseño antes del rework
con TutorLMS. Tiene `userId`, `trainingUserId`, `courseId`, `status`,
`certificateUrl`, etc. **No tiene asociaciones declaradas** en
`tenantDb.js` (no aparece en las líneas 99-111 de asociaciones de
formación, aunque sí se define el modelo en línea 47). Se conserva el
modelo y la tabla pero ningún flujo de la app lo lee ni lo escribe.
Candidato a borrar tras una verificación con producción.

## Endpoints internos (con JWT)

Todos pasan por `withTenant` y validan `hasModule("training")`. Las
**mutaciones requieren rol admin/superadmin** (igualado al patrón de
`leads`, `team` y `billing`). `GET` sigue abierto a cualquier
autenticado del tenant.

### Courses

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/training/courses` | Lista con filtro `?active=true|false`. Orden por nombre. | `hasModule(...)` |
| `POST /api/training/courses` | Crea curso (`name` obligatorio). | Solo admin/superadmin. |
| `PUT /api/training/courses/[id]` | Actualiza campos whitelisted (`name`, `wpCourseId`, `wcProductId`, `active`). | Solo admin/superadmin. |
| `PATCH /api/training/courses/[id]` | Alias de PUT (la UI nueva del sprint F3 usa PATCH; misma whitelist y validaciones). | Solo admin/superadmin. |
| `DELETE /api/training/courses/[id]` | **Hard delete**. | Solo admin/superadmin. |
| `GET /api/training/sync-status` | Última fila del log `training_sync_log` para este tenant + metadatos de UX (`syncEnabled`, `syncUrl`). Ver "Sincronización con TutorLMS" más abajo. | `hasModule(...)` |

No hay `GET /api/training/courses/[id]` individual; el detalle se
obtiene del listado.

### Sincronización con TutorLMS (sprint F3)

El flujo de sync de cursos completo (bulk) lo dispara manualmente
Belén desde el wp-admin de Retorika:

1. Belén visita una URL pública del WP de Retorika
   (`?retorika_sync_courses=1`).
2. Un script PHP del plugin lee el post type `courses` (con su meta
   `_tutor_course_product_id` que vincula curso ↔ producto Woo) y
   hace `POST` al webhook
   `/api/webhooks/tutorlms/sync-courses` firmando con HMAC.
3. El CRM hace UPSERT de los cursos recibidos y desactiva
   (`active=false`) los cursos del tenant que no aparezcan en el
   array.
4. **Side effect (F3)**: tras el sync exitoso, el handler inserta
   una fila en `training_sync_log` con
   `source='wp_tutor_courses'`, `syncedAt=NOW()`,
   `itemsSynced`, `itemsDeactivated` y el resumen en `payload`. Si
   el INSERT falla, NO rompe la respuesta — el sync funcional ya
   está hecho.

El secret HMAC compartido vive en `CRM_WEBHOOK_SECRET` (legacy
`RETORIKA_WEBHOOK_SECRET` aceptado como fallback; ver "Decisión / Secret
HMAC fuera del repo"). El meta del curso
de TutorLMS que vincula con WooCommerce es
`_tutor_course_product_id`.

**Tabla `training_sync_log`** (sprint F3, multi-tenant):

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID PK | |
| `source` | ENUM (`wp_tutor_courses`) | Espacio para futuras fuentes. |
| `syncedAt` | TIMESTAMPTZ NOT NULL | Default `NOW()`. Índice DESC. |
| `itemsSynced`, `itemsDeactivated`, `itemsFailed` | INTEGER | |
| `payload` | JSONB nullable | Resumen para auditoría. |

**Gating de UX**: `/api/training/sync-status` consulta una variable
de entorno con la convención `{TENANT_SLUG_UPPER}_TUTOR_SYNC_URL`
(p.ej. `RETORIKA_TUTOR_SYNC_URL=https://asesoriaretorika.com/?retorika_sync_courses=1`).
La respuesta incluye:

```
{
  tenantSlug: "retorika",
  syncEnabled: true,                  // true SOLO si la env existe
  syncUrl: "https://asesoriaretorika.com/?retorika_sync_courses=1",
  lastSync: { lastSyncAt, itemsSynced, itemsDeactivated, source } | null
}
```

La UI (`/formacion/cursos`) muestra el banner solo si
`syncEnabled === true`. Patrón extensible: cualquier otro tenant que
en el futuro contrate flujo TutorLMS solo necesita su propia
variable `{SLUG}_TUTOR_SYNC_URL` y el banner aparece
automáticamente.

Migración: la tabla `training_sync_log` y el enum
`enum_training_sync_log_source` los crea
`scripts/migrate-training-archive.js`
(`npm run db:migrate:training-archive`), junto con la columna
`archived_at` en `training_users`.

### Companies

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/training/companies` | Lista con `courseCount` y `userCount` agregados. Sin paginación. | `hasModule(...)` |
| `POST /api/training/companies` | Crea empresa. | Solo admin/superadmin. |
| `GET /api/training/companies/[id]` | Detalle con `courses` incluidos. | `hasModule(...)` |
| `GET /api/training/companies/[id]/courses` | Atajo: solo los cursos asignados. | `hasModule(...)` |
| `POST /api/training/companies/[id]/courses` | Asigna un curso a la empresa (idempotente). | Solo admin/superadmin. |
| `DELETE /api/training/companies/[id]/courses/[courseId]` | Desasigna. | Solo admin/superadmin. |

**No hay PATCH ni DELETE de Company**. Una empresa creada por error no
se puede editar ni borrar desde la API. Hay que tocar BD a mano.

### Users (TrainingUser)

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/training/users` | Lista paginada con filtros `type`, `companyId`, `search`. Por defecto filtra `archivedAt IS NULL`; soporta `?includeArchived=true` (todos) y `?archivedOnly=true` (solo archivados). | `hasModule(...)` |
| `GET /api/training/users/[id]` | Detalle individual del empleado, incluyendo `archivedAt`. NO filtra por archivado: útil para que el drawer muestre el detalle de un archivado. | `hasModule(...)` |
| `POST /api/training/users` | **Crear empleado individual** desde UI (formulario en la ficha de empresa). Body: `{ companyId, email, name?, lastName?, birthDate?, nif? }`. Se crea con `type='company'` y `active=false` (pre-aprobado, mismo flujo que el import). Email único: si ya existe y está archivado → reactiva y reasigna a la empresa; si existe activo → 409. | Solo admin/superadmin. |
| `POST /api/training/users/import` | Carga masiva desde Excel. Resuelve empresa por nombre o `externalId`. Auto-detecta `type` (con companyId → `company`, sin → `private`). Default `active`: `false` para `type=company` (pre-aprobado, pendiente de activación vía `register/empresa`); `true` para `type=private`. **Reactiva archivados**: si encuentra un email con `archivedAt != null`, lo restaura (`archivedAt = null`) y cuenta como `updated`. | Solo admin/superadmin. |
| `DELETE /api/training/users/[id]` | **Soft delete** por defecto: marca `archivedAt = NOW()`. Conserva la fila, matrículas y cuestionarios. Idempotente (si ya estaba archivado devuelve 200 con `noop:true`). Con `?hard=true`: **borrado físico** en transacción — borra `CourseEnrollment` + `CourseRegistration` con `trainingUserId = id` y luego la fila de `training_users`. `QuizAttempt` se conserva (no tiene FK; se asocia por email/wpUserId). Irreversible. | Solo admin/superadmin. |
| `POST /api/training/users/[id]/restore` | Restaura un empleado archivado (`archivedAt = NULL`). No toca `active` ni `type`. Idempotente. | Solo admin/superadmin. |
| `GET /api/training/users/export` | Excel con todos los usuarios filtrados. | `hasModule(...)` |

Para activar a un empleado de empresa el flujo es
`POST /api/usuarios/register/empresa` (activa + materializa
matrículas a partir de `company_courses`, ver "Flujo end-to-end de
pre-aprobación de usuarios empresa" más arriba). Para archivar
(retirar acceso conservando historial) hay dos vías: la UI del CRM
(`/formacion/empresas/[id]` tab Empleados, botón "Archivar" — o
`/formacion/usuarios` desde la columna acciones) o llamando directo
a `DELETE /api/training/users/[id]`.

### Eliminar definitivamente (hard delete)

Para casos puntuales (limpieza de pruebas, GDPR, errores) se puede
borrar la fila de forma irreversible llamando a
`DELETE /api/training/users/[id]?hard=true`. La UI lo dispara desde
el botón "Eliminar" tanto en la ficha de empresa (tab Empleados)
como en `/formacion/usuarios`. El dialog exige al admin **escribir
el email exacto del usuario** para confirmar (anti pulsación
accidental).

Lo que se borra en la transacción:

| Tabla | FK | Acción |
| --- | --- | --- |
| `course_enrollments` | `trainingUserId` | DELETE en cascada (Sequelize, no DB) |
| `course_registrations` | `trainingUserId` | DELETE en cascada (Sequelize, no DB) |
| `training_users` | — | DELETE de la fila |
| `quiz_attempts` | — | **No se toca** (asocia por `studentEmail` / `wpUserId`, sin FK) |

Si la transacción falla en cualquier paso, no se commitea nada.
Soft delete (`archivedAt`) sigue siendo la opción primaria recomendada:
es reversible y conserva el historial.

### Crear empleado individual desde UI

`POST /api/training/users` — alternativa al import de Excel cuando
solo hay que dar de alta a 1 persona. Se invoca desde la ficha de
empresa → tab Empleados → botón **"+ Crear empleado"**. Drawer con
campos: email (obligatorio), nombre, apellidos, fecha de nacimiento,
NIF. El usuario se crea con `type='company'` y `active=false`
(pre-aprobado); se activará automáticamente cuando complete el
registro en el campus, igual que un empleado importado por Excel.

Reglas de email único:

- Si el email no existe → crea fila nueva.
- Si el email existe **archivado** → reactiva (`archivedAt = null`),
  reasigna a la `companyId` indicada y actualiza name/lastName/nif/birthDate
  si vienen en el body (mismo criterio que el import).
- Si el email existe **activo** → devuelve 409.

### Empleados archivados (`archivedAt`)

Soft delete: el campo `training_users.archived_at` (TIMESTAMPTZ
nullable) marca la fecha en la que se archivó. Mientras `archivedAt`
sea `NULL`, el empleado se trata como "vivo" en todas las consultas.

- **Archivar**: `DELETE /api/training/users/[id]` → set `archivedAt =
  NOW()`. La UI lo dispara desde el botón "Archivar" en el tab
  Empleados de la ficha de empresa.
- **Restaurar**: dos vías equivalentes — `POST /api/training/users/[id]/restore`
  (set `archivedAt = NULL`) o re-importar un Excel que contenga el
  email; `POST /api/training/users/import` detecta el archivado y lo
  reactiva como parte del MERGE (lo cuenta en `updated`).
- **Comportamiento de `/register/empresa`**: la query
  `WHERE email, type='company', archivedAt IS NULL` excluye
  archivados. Si el empleado está archivado, la respuesta es la
  misma que si no existiera (`{exists: false}` con 403); en logs
  se registra `[training] register/empresa intentado con usuario
  archivado email=...` para detectar intentos.
- **Filtros del listado**: por defecto los endpoints `GET` filtran
  archivados. `?includeArchived=true` los incluye junto con los
  activos; `?archivedOnly=true` muestra solo los archivados. La UI
  expone esto como un chip "Archivados" en el tab Empleados.

Migración: `scripts/migrate-training-archive.js` (idempotente,
multi-tenant) añade la columna `archived_at` en cada tenant que tenga
la tabla `training_users`. Los tenants sin el módulo training (sin la
tabla) se saltan sin error. Comandos:
`npm run db:migrate:training-archive` (local) y
`npm run db:migrate:training-archive:prod` (producción).

### Enrollments

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/training/enrollments` | Listado paginado. Filtros `courseId`, `companyId`, `search`. Devuelve `trainingUser` y `course` incluidos. | `hasModule(...)` |
| `GET /api/training/enrollments/export` | Excel con todas las matrículas filtradas. | `hasModule(...)` |

Sin POST/PATCH/DELETE: las matrículas se crean exclusivamente vía
webhooks o sync. No se pueden editar manualmente desde el CRM.

### Quiz attempts

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/training/quiz-attempts` | Listado paginado. Filtros `search`, `companyName` (alias legacy: `empresa`), `result`, `courseId`, `quizId` (sprint Bloque 3). Excluye `answers` para aligerar. | `hasModule(...)` |
| `GET /api/training/quiz-attempts/[id]` | Detalle con `answers` JSONB completo. | `hasModule(...)` |
| `GET /api/training/quiz-attempts/stats?search=&companyName=&courseId=&quizId=` | **Sprint Retorika Bloque 3.** Estadísticas agregadas. Dos modos: **A (sin `quizId`)** devuelve `{ total, passCount, failCount, passRate, avgScorePct, topQuizzesByAttempts: [...×5], topQuizzesByFailRate: [...×5] }` con rankings globales. Mode B (con `quizId`) devuelve `{ total, passCount, failCount, passRate, avgScorePct, questionStats: [{ no, questionId, question, type, totalResponses, correctCount, correctRate }] }` agregando `answers[]` JSONB por `(questionId, no)`. Umbral `HAVING COUNT(*) >= 3` en `topQuizzesByFailRate` para evitar ruido. Coherencia 3-vías con `/list` y los lists auxiliares (mismo WHERE). Log `[retorika:quiz-stats]`. | `hasModule("training" o "cuestionarios")` |
| `GET /api/training/quiz-attempts/quizzes-list?courseId=&companyName=` | **Sprint Bloque 3.** Lista DISTINCT de cuestionarios con count, derivada por `GROUP BY wp_quiz_id, quiz_title, wp_course_id, course_title` sobre `quiz_attempts`. Ordenada por count DESC. Pobla el dropdown "Cuestionario" en /formacion/cuestionarios. Cuestionarios sin ningún intento NO aparecen (no hay tabla `quizzes` separada — backlog). | `hasModule("training" o "cuestionarios")` |
| `GET /api/training/quiz-attempts/courses-list` | **Sprint Bloque 3.** Lista DISTINCT de cursos con intentos, derivada por `GROUP BY wp_course_id, course_title`. Sin filtros. Pobla el dropdown "Curso". | `hasModule("training" o "cuestionarios")` |
| `GET /api/training/quiz-attempts/companies-list` | **Sprint Bloque 3.** Lista DISTINCT del campo libre `empresa` con count, ordenada DESC. `LIMIT 100`. Pobla el dropdown "Empresa" (reemplaza al input texto libre anterior). | `hasModule("training" o "cuestionarios")` |

Sin PATCH ni DELETE: igual que enrollments, los intentos llegan solo
por webhook o sync.

### Cuestionarios (alias)

`/api/cuestionarios` y `/api/cuestionarios/sync` son alias del
sub-módulo de quiz. Aceptan tanto `hasModule("training")` como
`hasModule("cuestionarios")` — porque algunos tenants antiguos tienen
el módulo registrado con el nombre `cuestionarios` por separado. La
ruta del frontend `/cuestionarios` redirige a `/formacion/cuestionarios`.

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/cuestionarios` | Idéntico a `GET /api/training/quiz-attempts`. | `hasModule("training" o "cuestionarios")` |
| `GET /api/cuestionarios/[id]` | Idéntico a `GET /api/training/quiz-attempts/[id]`. | idem |
| `POST /api/cuestionarios/sync` | Pull desde TutorLMS REST API. Lee `WP_URL`, `WP_API_USER`, `WP_API_KEY` de env. | Solo admin/superadmin. |

## Endpoints externos (sin JWT)

Resumen rápido (detalle en "Integraciones externas"):

| Método y ruta | Auth | Tenant resuelto |
| --- | --- | --- |
| `POST /api/webhooks/tutorlms/course` | HMAC SHA256 (`RETORIKA_WEBHOOK_SECRET` env) + `hasModule("training")` | `x-tenant` header / subdominio |
| `POST /api/webhooks/tutorlms/enrollment` | idem | idem |
| `POST /api/webhooks/tutorlms/quiz-attempt` | idem | idem |
| `POST /api/webhooks/tutorlms/sync` | idem | idem |
| `POST /api/webhooks/tutorlms/sync-courses` | idem | idem |
| `GET /api/external/retorika/alumnos[/:email]` | API key `x-api-key` (env) | Hardcoded a `retorika` |
| `GET /api/external/retorika/cursos` | API key | idem |
| `GET /api/cursos-empresas/codigos-cursos/:email` | Sin secret | `x-tenant` header |
| `POST /api/usuarios/register/empresa` | Sin secret | `x-tenant` header |

## Validaciones críticas

- **HMAC**: si la firma no coincide → `401 "Firma inválida"`. Usa
  `timingSafeEqual` para evitar timing attacks. Acepta tanto
  `sha256=<hex>` como `<hex>`.
- **Email único en `TrainingUser`**: garantizado por índice único
  `training_users_email_unique` en BD (creado por
  `migrate-training-fields.js`). Webhooks concurrentes con el mismo
  email fallan en uno de los dos al intentar el INSERT en lugar de
  crear duplicados.
- **CourseEnrollment idempotente**: UNIQUE
  `(trainingUserId, courseId)` + `findOrCreate` evita duplicar
  matrículas.
- **CompanyCourse idempotente**: UNIQUE `(companyId, courseId)` + `findOrCreate`.
- **`/api/usuarios/register/empresa`**: activa al usuario (y crea sus
  matrículas en `course_enrollments`, en transacción) si ya existe
  con `type = "company"` (creado previamente vía import).
  Distingue 403 ("no autorizado") de 200 ("ya activo") — eso permite
  enumeración.
- **Validación de email en modelo `TrainingUser`**: `isEmail`
  Sequelize. El hook `beforeSave` normaliza a lowercase + trim.

## Frontend

Páginas bajo `app/(dashboard)/formacion/`. Componentes compartidos en
`components/training/` (`TrainingTable`, `TypeBadge`, `ActiveBadge`).

El overview (`/formacion`) usa el mismo patrón de override por tenant
que el módulo de leads: `app/(dashboard)/formacion/page.jsx` selecciona
entre `modules/training/FormacionOverview.jsx` (default, copy orientado
a Retorika con WP + TutorLMS) y los overrides de `modules/overrides/{slug}/FormacionOverview.jsx`.
Hoy solo `aumenta` tiene override propio. `nutri_laura` y `retorika` usan
el default (las 5 secciones). El override antiguo de `nutri_laura` (copy
nutricional B2C sin "Empresas" ni "Cuestionarios") se eliminó cuando Laura
decidió usar la UI completa. Las páginas internas (`/formacion/cursos`,
`/formacion/usuarios`, etc.) son comunes a todos los tenants.

| Ruta | Función |
| --- | --- |
| `/formacion` | Overview con métricas (empresas, cursos, usuarios, matrículas) y accesos rápidos a las 5 sub-secciones. |
| `/formacion/empresas` | Listado de empresas + modal "Nueva empresa". |
| `/formacion/empresas/[id]` | Detalle de empresa con asignación/desasignación de cursos. |
| `/formacion/cursos` | Listado simple de cursos. Sin alta desde la UI (los cursos se sincronizan desde WP). |
| `/formacion/usuarios` | Listado de `TrainingUser` con filtros y carga Excel. |
| `/formacion/alumnos` | Listado de matrículas (`CourseEnrollment`). |
| `/formacion/cuestionarios` | Dashboard de estadísticas + listado de intentos + drawer de detalle. Sprint Retorika Bloque 3 (jun 2026) añade el dashboard `modules/cuestionarios/CuestionariosDashboard.jsx` arriba con dos modos: A (vista global con 4 cards + top 5 cuestionarios por intentos y top 5 por menor acierto) y B (vista por cuestionario con 3 cards + `% acierto por pregunta`). Filtros lift-up: `search`, `companyName` (dropdown poblado por `companies-list`, antes input texto libre), `courseId` (dropdown poblado por `courses-list`), `quizId` (dropdown poblado por `quizzes-list`, filtrado por curso seleccionado, con botón `✕ Quitar`). Filtro `result` (pass/fail) eliminado de la UI (sigue aceptado por el endpoint para compat). |
| `/cuestionarios` | Redirige a `/formacion/cuestionarios` (mantiene URL antigua). |

## Filtrado de campos sensibles

En este módulo **no hay filtrado por rol**. Cualquier usuario
autenticado del tenant ve todos los campos de:

- `TrainingUser`: incluye `nif`, `birthDate`, `country` y `email`.
- `QuizAttempt`: incluye `studentEmail` y respuestas individuales en
  `answers` (cuando se consulta el detalle).
- `CourseEnrollment`: con todos los datos del alumno enlazado.

Decisión a tomar: el `nif` y `birthDate` son datos personales y, según
RGPD, su acceso debería estar restringido. Hoy no hay fricción
técnica para que un user normal del tenant los vea ni los exporte.
Apuntado en backlog.

## Seed y configuración inicial

Tres scripts orientados al demo. Para Retorika la configuración real
viene del propio TutorLMS.

| Script | Propósito |
| --- | --- |
| `scripts/seed-retorika.js` | Crea schema `crm_retorika` y siembra el primer curso ("IA y comunicación política", `wpCourseId: 6434`). Idempotente. **Solo añade el curso semilla**; el resto de cursos llegan vía webhook desde WP. |
| `scripts/add-training-module-demo.js` | Activa el módulo `training` en el tenant `demo` y siembra 4 empresas, 8 cursos, ~36 alumnos de empresa + 10 privados, ~55 matrículas. Para demos a clientes potenciales. Idempotente. |
| `scripts/seed-cuestionarios-demo.js` | Activa el módulo `cuestionarios` en demo y siembra intentos de quiz realistas (datos pedagógicos sobre comunicación, módulos de Retorika). Útil para mostrar la pestaña Cuestionarios sin necesitar webhooks. |
| `scripts/add-training-module-nutri-laura.js` | Activa el módulo `training` en `nutri_laura`. Crea las 6 tablas con SQL crudo (sin la legacy `trainings`), registra el módulo sin `uiOverride` (usa el default igual que retorika) y siembra 3 cursos de nutrición. Patrón idéntico al `add-leads-module-nutri-laura.js` por la filosofía de tenant minimal. |
| `scripts/add-training-module-aumenta.js` | Activa el módulo `training` en `aumenta`. Las 6 tablas ya existen desde el sync inicial — el script solo registra el módulo con `uiOverride: aumenta/FormacionOverview` y siembra 6 cursos reales de la web de Aumenta + 15 alumnos B2C + 22 matrículas. Sin cuestionarios (la tabla `quiz_attempts` queda vacía). Ver "Activación en Aumenta" más abajo. |

`seed-master.js` (que crea el tenant retorika) registra el módulo
`training` con `moduleAccess` admin. La activación inicial del
módulo en producción se hizo con ese script.

## Migración

`scripts/migrate-training-fields.js` (idempotente, lee schemas desde
`master.tenants`):

- Crea `UNIQUE INDEX training_users_email_unique` sobre `email` en
  cada `crm_*.training_users`.
- Antes de crear el índice detecta duplicados por tenant; si los hay
  salta ese tenant y reporta para limpieza manual (los demás siguen).
- Tenants sin la tabla `training_users` (módulo no instalado) se
  saltan con `no-table`.

Comandos: `npm run db:migrate:training` (local) y
`npm run db:migrate:training:prod` (VPS).

Resultado en local (2026-05-04): migrados `crm_demo`,
`crm_spain_enzymes`; saltados `crm_aumenta` y `crm_quality_energy`
(no tienen tabla `training_users`).

## Activación en Aumenta (B2C, sin cuestionarios)

Aumenta es centro de psicopedagogía infantil. Su formación es 100%
B2C: las familias y profesionales sueltos se inscriben individualmente
en cursos abiertos. No hay empresas intermediarias ni TutorLMS
conectado.

### Datos sembrados (8 jun 2026)

- **6 cursos reales** copiados de su web pública:
  - Entender el espectro autista
  - Regulación emocional en la infancia
  - Cuidar a quien cuida
  - Integración sensorial en el aula
  - Primeras palabras y comunicación
  - Entendiendo el TDAH en casa
- **15 alumnos B2C** ficticios (mezcla de familias y profesionales).
- **22 matrículas** distribuidas.
- **0 empresas** (`companies` vacío).
- **0 cuestionarios** (`quiz_attempts` vacío).

### Override de UI: `aumenta/FormacionOverview`

`modules/overrides/aumenta/FormacionOverview.jsx`. Diferencias frente
a la landing `default`:

- **3 KPIs en vez de 4**: Cursos activos, Alumnos, Matrículas (sin
  "Empresas").
- **3 secciones en vez de 5**: Cursos, Alumnos, Matrículas por curso
  (sin "Empresas" ni "Cuestionarios").
- **Copy editorial adaptado**: título "Formación — cursos para
  familias y profesionales".
- **Sin endpoint a `/api/training/companies`** (la card de empresas
  no existe).

Registrado en `app/(dashboard)/formacion/page.jsx` en el map
`UI_OVERRIDES`. Tenant decide por `x-tenant` header.

### `logicOverrides` en `master.tenant_modules`

```json
{ "b2bEnabled": false, "quizzesEnabled": false, "tutorlmsConnected": false }
```

Estos flags hoy son **indicativos** (los lee solo el override de UI).
No hay validación de backend que los consulte.

### Cuestionarios para Aumenta

Decisión cerrada: **Aumenta no usa cuestionarios** en su flujo
formativo. La tabla `quiz_attempts` existe en `crm_aumenta` desde el
sync inicial pero queda vacía. El override de UI no muestra la
sección. Si en el futuro Aumenta los quisiera, basta con:

1. Cambiar `logicOverrides.quizzesEnabled = true`.
2. Añadir la sección "Cuestionarios" al override
   `aumenta/FormacionOverview.jsx`.

## Integraciones con otros módulos del CRM

- **Clientes (#1)**: sin enlace. `Company` (training) y `Client`
  (clients) son tablas separadas sin FK. Ver "Modelos / Company".
- **Equipo (#6)**: sin enlace. `TrainingUser` y `TeamMember` son
  tablas distintas con propósitos distintos (alumnos vs. empleados).
- **Auth (master.User)**: sin enlace. El alumno (`TrainingUser`) **no
  tiene login** en el CRM; es una entidad puramente analítica que
  refleja a un usuario que vive en WordPress.
- **Audit (master.AuditLog)**: el módulo no escribe ningún evento.
- **n8n**: sin integración explícita. Los webhooks vienen
  directamente de TutorLMS (un plugin WP), no de n8n.

## Backlog

Detectado durante la documentación, en orden vagamente sugerido:

### Sprint Retorika · Bloque 3 (Cuestionarios) — apuntes diferidos

- **Refactor del monolito `modules/cuestionarios/CuestionariosModule.jsx`**
  (~810 líneas tras Bloque 3). Partir en `AttemptsList.jsx`,
  `AttemptDetail.jsx`, `QuizzesSyncNotice.jsx`, `helpers.js` para mantenibilidad.
- **Normalizar `quiz_attempts.empresa` a FK `companyId`**: hoy es string
  libre y el filtro empresa usa ILIKE substring. Implicación: dos variantes
  de nombre ("Trinity College" / "Trinity College Boadilla") cuentan como
  empresas distintas. Migración: lookup por nombre normalizado contra
  `companies.name` en webhook/sync.
- **Modelo `Quiz` separado** (catálogo de cuestionarios sin depender de que
  existan intentos). Hoy `quizzes-list` deriva por DISTINCT, así que
  cuestionarios sin intentos son invisibles. Si Belén quiere preparar stats
  antes del primer intento o ver "cuestionarios creados pero sin uso", hace
  falta tabla con FK a Course.
- **Export XLSX de intentos** (similar al de Registros del curso del Bloque
  1). Endpoint `/api/training/quiz-attempts/export` con los mismos filtros
  + hoja "Detalle por pregunta" desplegando `answers[]` JSONB.
- **Filtros por fecha en /formacion/cuestionarios** (`from`/`to`). Hoy el
  endpoint no los acepta. Útil para Belén cuando quiera "intentos del último
  mes" sin filtrar todo el histórico.
- **Coherencia del alias `/api/cuestionarios/*`**: la nueva quizId filter
  del Bloque 3 SOLO se añadió al endpoint canónico
  `/api/training/quiz-attempts/route.js`. El alias `/api/cuestionarios/route.js`
  no la acepta. Hoy no rompe nada (el frontend usa el canónico) pero divergencia
  apuntada.
- **Question-text drift**: el endpoint `/stats` Modo B usa el texto y `type`
  de la PRIMERA pregunta encontrada por `(questionId, no)`. Si TutorLMS
  reformula la pregunta, intentos antiguos guardan el texto antiguo. Stats
  agregadas siguen siendo correctas (por count) pero el rótulo puede
  desactualizarse. Versionado de pregunta = backlog largo plazo.
- **Estado huérfano del filtro `quizId`** al cambiar `companyName`: si el
  quiz seleccionado desaparece de la nueva quizzes-list filtrada por
  empresa, el filtro queda pero el dashboard mostrará 0 datos. Belén tiene
  el botón `✕ Quitar` para resolverlo. Auto-clear opcional.

### Backlog general

- **PATCH y DELETE de Company** (hoy no se pueden editar ni borrar
  desde API).
- **POST/PATCH/DELETE individuales de TrainingUser** (hoy solo
  import/export Excel).
- **Auditoría** mínima de operaciones (al menos webhooks y delete de
  curso).
- **Filtrado de NIF y birthDate** según rol (RGPD).
- **Reportes B2B** para enviar a la empresa cliente (progreso por
  alumno, certificados emitidos, tasa de aprobados).
- **Generación de certificados PDF** automática al completar un curso.
- **Fusión de `Company` (training) y `Client` (clients)**: decisión
  estratégica. Hoy duplican el concepto de "empresa cliente".
- **Eliminar el modelo `Training`** legacy si se confirma que ningún
  flujo lo usa (ver "Limitaciones / Backlog" #9).
- **Sincronización inversa CRM → TutorLMS**: hoy es unidireccional.
- **Rate limiting** en webhooks y endpoints externos.
- **Captcha o token compartido** en `/api/usuarios/register/empresa` y
  `/api/cursos-empresas/codigos-cursos/:email` (ver #6 y #7).
- **HMAC secret por-tenant**. `lib/training/webhookAuth.js` lee un
  único `RETORIKA_WEBHOOK_SECRET`. Funcional mientras solo Retorika
  reciba webhooks de TutorLMS. Cuando un segundo tenant (nutri_laura
  está perfilado) conecte su propio WP + TutorLMS, hay que pasar el
  slug del tenant al helper y leer `TUTORLMS_WEBHOOK_SECRET_{SLUG}`
  (o un valor desde `tenant.settings`) para que cada cliente firme
  con su propio secret. Compartir secret entre tenants es un riesgo:
  un WP comprometido escribiría sobre los demás.

## Incoherencias resueltas en este sprint

Cinco de las diez incoherencias detectadas durante la documentación
inicial se arreglaron en este mini-sprint de seguridad (2026-05-04).
Las cinco restantes están listadas como "Limitaciones conocidas /
Backlog" más abajo.

### 1. Secret HMAC fuera del repo (era CRÍTICO)

Los cinco webhooks bajo `/api/webhooks/tutorlms/*` tenían el secret
hardcodeado como constante en cada fichero. Solución:

- Helper compartido `lib/training/webhookAuth.js` con
  `verifyHmacSignature(rawBody, signatureHeader)`.
- El helper lee `process.env.RETORIKA_WEBHOOK_SECRET` en runtime y
  loggea un aviso ruidoso si la variable no está configurada (falla
  todas las firmas en ese caso).
- `RETORIKA_WEBHOOK_SECRET` añadida a `.env.production.example` como
  placeholder.
- **Rotación obligatoria** del secret en producción y en el plugin
  de WordPress de Retorika (ambos lados deben usar el mismo valor).
  El secret antiguo sigue siendo válido en git history y debe
  considerarse comprometido.

### 2. Eliminados console.log con PII (era CRÍTICO)

`app/api/webhooks/tutorlms/quiz-attempt/route.js` tenía cinco
`console.log` de diagnóstico que dumpaban a stdout: nombre y email
del alumno, preguntas, respuestas y datos del intento. Con cada
intento de cuestionario en producción, los logs (Docker stdout y
cualquier sink externo) recibían PII. Solución: eliminados los cinco.
Auditoría confirmada: no quedan `console.log` en `app/api/`.

### 3. Guard de admin en mutaciones de `/api/training/*` y `/api/cuestionarios/sync`

Antes solo validaban `hasModule("training")`. Ahora todas las
mutaciones requieren rol admin/superadmin con respuesta `403 "Solo
administradores pueden modificar este recurso"`. Endpoints afectados:

- `POST /api/training/courses`
- `PUT /api/training/courses/[id]`
- `DELETE /api/training/courses/[id]`
- `POST /api/training/companies`
- `POST /api/training/companies/[id]/courses`
- `DELETE /api/training/companies/[id]/courses/[courseId]`
- `POST /api/training/users/import`
- `POST /api/cuestionarios/sync`

`GET` siguen abiertos a cualquier autenticado del tenant. Mismo
patrón que `leads`.

### 4. Webhooks validan `hasModule("training")`

Tras validar HMAC y resolver tenant, los cinco webhooks comprueban
`ctx.hasModule("training")` antes de cualquier escritura; si el
módulo no está activo en ese tenant, devuelven `403`. Cierra el
vector de "secret válido + `x-tenant` arbitrario" para escribir en
tenants que no usan formación.

### 8. UNIQUE en `TrainingUser.email`

Se añadió índice único `training_users_email_unique` en BD vía
`scripts/migrate-training-fields.js` (idempotente, multi-tenant,
con detección de duplicados previa por tenant). El modelo Sequelize
también declara `unique: true` para reflejar la constraint. Resultado
en local: migrados `crm_demo` y `crm_spain_enzymes`; saltados
`crm_aumenta` y `crm_quality_energy` por no tener tabla
`training_users` (sin módulo training).

## Limitaciones conocidas / Backlog (no resueltas en este sprint)

### 5. Endpoints externos hardcodean `SLUG = "retorika"`

`/api/external/retorika/*` siempre consulta el schema de Retorika
ignorando cualquier `x-tenant`. Eso está bien hoy (solo Retorika lo
usa) pero rompe la promesa multi-tenant del CRM. Si en el futuro otro
cliente quiere su propia API externa con la misma estructura, hay que
duplicar la ruta. Mejor: parametrizar el slug con un mapping
controlado (whitelist de tenants externos + apikey distinta por cada
uno).

### 6. `/api/usuarios/register/empresa` permite enumeración de emails

El endpoint distingue tres casos:

- Email no existe como `type: "company"` → `403 { exists: false }`
- Email existe y ya está activo → `200 { exists: true, already_active: true }`
- Email existe inactivo → activa y devuelve `200 { exists: true, product_ids }`

Eso permite a un atacante (con el `x-tenant` correcto) iterar emails y
saber cuáles están en proceso de onboarding. El caso 200 con
`product_ids` además filtra qué cursos tiene contratados la empresa
del email enumerado.

Mitigaciones posibles: respuesta uniforme (200 sin distinguir) +
loguear los intentos para alertas; o exigir un token compartido entre
WordPress y CRM además del slug.

### 7. `/api/cursos-empresas/codigos-cursos/:email` permite enumeración silenciosa

Devuelve `[]` para email inexistente y `[wcProductIds]` para existente.
Sin diferenciación de status. Permite barrer emails y construir un
mapa "qué cursos ha comprado cada cliente". Sin auth ni rate limiting.

Decisión: para el flujo legítimo (WP llama esto en cada page-load del
área de cursos), un secret compartido o IP allowlist sería suficiente.
Hoy no hay nada.

### 9. Modelo `Training` legacy sin asociaciones ni uso

`models/tenant/Training.model.js` define una tabla con FK a `userId`
(que ni siquiera existe como `TeamMember.id` ni `User.id` claramente),
`courseId` y `trainingUserId`. La definición se carga en `tenantDb.js`
(línea ~47) pero **no aparece en las asociaciones de formación**
(líneas 99-111) ni en ningún endpoint. Es un esquema huérfano del
primer diseño.

Verificar en producción si la tabla `trainings` tiene filas. Si está
vacía: borrar modelo + DROP TABLE en migración. Si tiene filas:
investigar de dónde vinieron.

### 10. `/api/training/quiz-attempts` y `/api/cuestionarios` duplicados

Mismas dos rutas (`GET` listado y `GET` detalle) implementadas dos
veces. La pestaña frontend `/formacion/cuestionarios` carga el
módulo `CuestionariosModule.jsx` que **podría** estar usando una u
otra (verificar). El módulo `cuestionarios` como `moduleKey` en
master existe como alias. Decisión a tomar: unificar bajo
`/api/training/quiz-attempts` (más coherente con la ruta del módulo)
o bajo `/api/cuestionarios` (más legible para el alias). Hoy
funcionan en paralelo, lo cual añade superficie de bug.

## Registros previos al curso (sprint Retorika · junio 2026)

> En la UI, la tab se renombró a **"Registros del curso"** (texto más
> claro para el cliente). El nombre del sprint se mantiene como nombre
> histórico de la feature.

### Visión general del flujo

Antes de acceder al curso "Liderazgo Educativo" (course_id=5383 en TutorLMS,
product_id=5487 en WooCommerce), el alumno debe rellenar un formulario
inicial: datos del centro, perfil docente y un diagnóstico de motivación/
estrés. Es obligatorio para la bonificación FUNDAE.

```
Alumno logueado en WP de Retorika
      │
      ▼ entra a /courses/liderazgo-educativo/
┌────────────────────────────────────────────┐
│  WP snippet PHP template_redirect          │
│  GET CRM /webhooks/.../registro-curso/check│  HMAC sha256(queryString URL-encoded)
└────────────────────────────────────────────┘
      │
      ├─ has=true  → permitir acceso al curso
      └─ has=false → wp_safe_redirect a /registro-liderazgo-educativo/
                              │
                              ▼ shortcode [retorika_registro_form]
                ┌──────────────────────────────────┐
                │  Form HTML en WP                 │
                │  POST CRM /registro-curso        │  Modo browser
                │  (sin HMAC; valida Origin)       │  (Origin asesoriaretorika.com)
                └──────────────────────────────────┘
                              │
                              ▼
                       CRM crea:
                       · CourseRegistration (centerData, teacherData, diagnosisData, rawPayload)
                       · TrainingUser (find-or-create por email)
                       · Vínculo auto a Company por NIF (si existe)
                       · Audit log training.course_registration.created
                              │
                              ▼
                       Redirige al curso → ahora has=true → entra
```

### Setup en el CRM

**Variables env requeridas** (`.env.production`):
```
CRM_WEBHOOK_SECRET=<32+ bytes random, mismo en los WP conectados>
```
(El nombre viejo `RETORIKA_WEBHOOK_SECRET` sigue aceptándose como fallback.)

Sin esta variable, las firmas HMAC se rechazan automáticamente y todo el
flujo cae a fail-open en el WP (degradación elegante; el alumno entra al
curso sin gatekeeper).

**Modelos involucrados**:

| Modelo | Rol |
|---|---|
| `CourseRegistration` | Nuevo en este sprint. Una fila por `(email, wpProductId)` con todos los datos del formulario (`centerData`/`teacherData`/`diagnosisData` JSONB + `rawPayload` snapshot). |
| `Course` | Lookup por `wpCourseId`; debe existir antes del POST. La crea Belén desde `/formacion/cursos` (manual o sync TutorLMS). |
| `Company` | Lookup por `nif`. Nuevo campo `nif` añadido a `companies` en este sprint. Si existe → el registro queda vinculado; si no, `companyId=null` y Belén lo asocia luego. |
| `TrainingUser` | Find-or-create por email (hook `beforeSave` lowercasea). Si `companyId == null` y hay Company → auto-vincula. NO sobreescribe vinculaciones manuales existentes. |

**Endpoints expuestos**:

| Método + ruta | Auth | Rate limit | Uso |
|---|---|---|---|
| `POST /api/webhooks/retorika/registro-curso` | **Modo 1**: header `x-tenant=retorika` + Origin/Referer en `{asesoriaretorika.com, www.asesoriaretorika.com}`. **Modo 2**: header `X-Retorika-Signature: sha256=<hmac rawBody>`. Si no cumple ninguno → 401 | 10/min browser · 60/min HMAC | Submit del form (browser) o reenvío server-to-server. Idempotente por `(email, wpProductId)` — segunda llamada devuelve `alreadyExists: true` con el mismo `registrationId`. |
| `GET /api/webhooks/retorika/registro-curso/check?email=&productId=` | `X-Retorika-Signature: sha256=<hmac queryString URL-encoded>` | 60/min | Lo llama el snippet PHP del WP. Devuelve `{ has: true|false }`. |
| `GET /api/training/course-registrations?courseId=...` | JWT + `hasModule(training)` | — | Listado paginado con filtros `search`/`companyId`/`from`/`to`. |
| `GET /api/training/course-registrations/[id]` | JWT | — | Detalle completo con relaciones. |
| `GET /api/training/course-registrations/stats?courseId=&search=&companyId=&from=&to=` | JWT | — | Respuesta `{ totalRegistrations, scales }` con 6 escalas Likert (`motivationCurrent`, `motivationVsStart`, `centerEnvironment`, `stressLevel`, `hasResources`, `socialRecognition`) — cada una con `{ type:"likert", distribution:{1..5:n}, average, total }` — y 2 escalas categóricas (`workloadFrequency`, `weeklyExtraHours`) con `{ type:"categorical", distribution:{<slug>:n}, total }`. `motivationVsStart` añade `breakdown3cat: { less, equal, more, lessPct, equalPct, morePct }` (1+2 → menos motivados / 3 → igual / 4+5 → más motivados). Mismos filtros que `/list` y `/export` (coherencia 3-vías via `buildRawFilters("cr")`). Diccionarios: `DIAGNOSIS_FULL_QUESTIONS`, `WORKLOAD_FREQUENCY` (+ `_ORDER`), `WEEKLY_EXTRA_HOURS` (+ `_ORDER`) en `lib/training/registrationLabels.js`. |
| `GET /api/training/course-registrations/export?courseId=&search=&companyId=&from=&to=` | JWT | — | XLSX nativo (ExcelJS) con 2 hojas: **"Registros"** (30 columnas con cabeceras humanas cortas, fecha nativa Excel para filtrado, panel congelado, autofilter en `A1:AD1`) y **"Diccionario de preguntas"** (10 filas — columna / pregunta completa / tipo escala). El texto largo de cada pregunta se importa desde `DIAGNOSIS_FULL_QUESTIONS` como fuente única; el endpoint solo aporta el mapping `columna`/`tipo`. Arrays (`positions`, `subjects`, `coursesTeaching`, `topicsOfInterest`) resueltos a labels en castellano vía diccionarios de `lib/training/registrationLabels.js`. Mismos filtros que `/list` y `/stats`. |

**Auto-vinculación TrainingUser → Company**:

Al recibir un POST exitoso, si el endpoint resuelve un `Company` por NIF y el `TrainingUser` recién creado/encontrado tiene `companyId == null`, se ejecuta `await user.update({ companyId: company.id })`. Si el `TrainingUser` ya tenía una `companyId` distinta, **NO se sobreescribe** — Belén puede haber hecho una vinculación manual deliberada. Para vincular retroactivamente TrainingUsers anteriores al sprint, hay que un script ad-hoc.

**Audit log**:

Cada POST exitoso escribe en `master.audit_logs`:
```
action      = "training.course_registration.created"
entity      = "CourseRegistration"
entity_id   = <uuid>
after       = {                                  ← metadata
  authMode:        "browser" | "hmac",
  origin:          "asesoriaretorika.com" | null,
  email:           "sm***@trinitycollege.es",    ← enmascarado
  productId:       5487,
  courseId:        "<uuid>",
  companyId:       "<uuid>" | null,
  trainingUserId:  "<uuid>"
}
ip          = "..."
```

### Setup en el WP del cliente (caso Retorika)

1. **Página WP `/registro-liderazgo-educativo/`** con shortcode
   `[retorika_registro_form]` (el shortcode entrega el HTML del form que
   hace POST al CRM desde el browser).

2. **Snippet PHP `template_redirect`** copiado de
   `docs/integrations/retorika-wp-snippet.php` al plugin de fragmentos de
   código. Lee `RETORIKA_WEBHOOK_SECRET` de `wp-config.php`.

3. **`wp-config.php`**:
   ```php
   define('RETORIKA_WEBHOOK_SECRET', 'EL_MISMO_SECRET_QUE_EL_CRM');
   ```

4. **Verificación**: usuario test sin registro → entra a curso → debe ser
   redirigido al form. Tras enviar form, vuelve al curso y entra normal.

### PRECISIÓN HMAC URL-encoding

**La firma del GET `/check` se calcula sobre el queryString CON URL-encoding
ya aplicado.** El `@` del email se codifica como `%40` antes de firmar.

| Lenguaje | Cómo |
|---|---|
| PHP (WP snippet) | `urlencode($email)` antes de concatenar → el `@` se convierte en `%40`. Luego `hash_hmac('sha256', $query, $secret)`. |
| JavaScript (cliente) | `new URLSearchParams({email, productId}).toString()` produce la versión codificada (`%40`). Luego `crypto.createHmac('sha256', secret).update(query).digest('hex')`. |
| Server (CRM) | `new URL(request.url).searchParams.toString()` — el mismo encoding que produce `URLSearchParams.toString()`. Se compara con `timingSafeEqual`. |

Cualquier desviación (firmar sobre el string con `@` literal, p. ej.) produce 401 "Firma inválida". Esto se descubrió en el smoke parcial del Checkpoint 1 — está aquí documentado para integradores futuros.

Ejemplo válido:
```
query firmada:    email=marta%40trinitycollege.es&productId=5487
firma esperada:   hex(HMAC-SHA256(query, secret))
header enviado:   X-Retorika-Signature: sha256=<firma>
URL del GET:      .../check?email=marta%40trinitycollege.es&productId=5487
```

### Uso para Belén (UI)

1. **Página de detalle del curso**:
   - Sidebar → Formación → Cursos → click en la fila "Liderazgo Educativo" (toda la fila es clickable).
   - URL directa: `/formacion/cursos/<id>`.

2. **Tab "Registros del curso"** (antes "Registros previos"):
   - Panel formato Retorika (rediseñado en sprint Retorika · jun 2026): grid responsivo (1 col mobile / 2 cols ≥md) con un bloque por escala — 6 bloques Likert (gráfico de barras verticales 1-5 con count encima, estrellas SVG con render continuo, media destacada `X.XX / 5`, total de encuestados al pie) + 2 bloques categóricos (`workloadFrequency`, `weeklyExtraHours`: barras horizontales por slug con label humano + count + porcentaje, sin estrellas ni media).
   - El bloque `motivationVsStart` añade sub-bloque 3-categorías (↓ Menos motivados / → Igual / ↑ Más motivados) con porcentaje a 2 decimales.
   - Empty state per-escala: si una escala concreta no tiene respuestas válidas en el filtro actual, su bloque muestra "Sin datos en el filtro actual" pero el resto se renderiza.
   - Reemplaza el panel anterior (4 cards arriba: Total / Motivación media / Estrés medio / Top empresa + toggle "Ver más estadísticas" → distribuciones 1-5 + top 10 empresas + registros por mes). Los datos "top empresa" y "registros por mes" ya no se muestran en el panel — siguen disponibles en BD y se pueden reintroducir si Belén los pide.

3. **Filtros**:
   - Búsqueda libre (email, nombre del centro, NIF) con debounce 300ms.
   - Empresa (dropdown desde `/api/training/companies`).
   - Atajos de fecha: 7d / 30d / 90d / Todo + pickers custom.
   - Los filtros aplican **tanto a la lista como a las estadísticas** — los 4 cards arriba reflejan exactamente lo que se ve abajo.

4. **Drawer detalle** (click en una fila):
   - Tabs internas: Centro / Docente / Diagnóstico.
   - Diagnóstico: barras 1-5 animadas con paleta semántica (motivación: alto = verde; estrés: alto = rojo).
   - Footer: "Ver empresa →" si está vinculada.

5. **Export Excel** (botón arriba derecha de la lista, antes "Exportar CSV"):
   - Respeta filtros activos (`courseId`, `search`, `companyId`, `from`, `to`).
   - XLSX nativo generado con ExcelJS. Dos hojas: "Registros" (30 columnas con cabeceras humanas cortas — eliminadas las técnicas `id`, `email` duplicado, `wpUserId`, `wpProductId`, `wpCourseId`) y "Diccionario de preguntas" (texto largo de cada pregunta del diagnóstico inicial + tipo escala).
   - Fecha nativa Excel en columna `Fecha inscripción` (`numFmt: dd/mm/yyyy hh:mm`) — Bea puede filtrar/ordenar como fecha real.
   - Arrays de slugs (`positions`, `subjects`, `coursesTeaching`, `topicsOfInterest`) resueltos a labels en castellano vía diccionarios de `lib/training/registrationLabels.js`. Panel congelado en cabecera, autofilter activo.
   - Filename: `registros-curso-{slug-curso}-{YYYY-MM-DD}.xlsx`.

### Troubleshooting

| Síntoma | Diagnóstico |
|---|---|
| El form en WP no envía / browser muestra CORS error | Verificar Origin: el form HTML debe servirse desde `asesoriaretorika.com` o `www.asesoriaretorika.com`. Cualquier otro dominio → 401 "Origen no autorizado" desde el CRM. |
| GET `/check` siempre devuelve 401 "Firma inválida" | (1) Comprobar que `RETORIKA_WEBHOOK_SECRET` en `wp-config.php` y en `.env.production` del CRM son **idénticos** byte a byte. (2) Comprobar URL-encoding del email (`@` → `%40` antes de firmar; ver sección "PRECISIÓN HMAC"). |
| GET `/check` devuelve `has=false` para un usuario que sí completó el form | Comprobar en BD: `SELECT * FROM crm_retorika.course_registrations WHERE LOWER(email)='...' AND wp_product_id=5487`. Si la fila existe pero el `/check` dice false, el problema está en el matching del email (mayúsculas, espacios) — los emails se lowercase en `beforeSave`. |
| Belén no ve la tab "Registros del curso" en `/formacion/cursos/[id]` | Verificar `master.users.module_access` del admin de Retorika: debe incluir `"training"` o el wildcard `["all"]`. |
| El form HTML pinta pero al hacer click "Enviar" no pasa nada visible | Abrir DevTools → Network → mirar el POST. (1) Si status 401 → ver header `x-tenant: retorika` está en la request. (2) Si status 422 → ver `body.error` y los `details[]` con el campo faltante. (3) Si status 200 con `alreadyExists: true` → el usuario ya estaba registrado; redirigir al curso. |

## Fix detección usuario empresa inactivo en registro privado (caso Alba · Trinity)

### Bug observado

Una alumna importada al CRM como `TrainingUser type=company, active=false`
(Trinity College) NO recibió las instrucciones de acceso por la vía
oficial y fue al form de registro privado del WP de Retorika. El check
del shortcode `[retorika_registro]` solo miraba metas de WordPress
(`tipo = Empresa` + `activo` falso vía `get_user_meta`), pero esta
alumna **aún no existía como usuario WP** — solo estaba importada al CRM.
Resultado: WP la creó como usuario privado, sin cursos de empresa
asignados, sin acceso al curso comprado por Trinity.

### Solución

El shortcode WP debe preguntar al CRM **antes** de crear el usuario.
Para eso se añade un endpoint específico que devuelve un booleano:

```
POST https://crm.salamandrasolutions.com/api/webhooks/retorika/check-empresa-user
Headers:
  Content-Type: application/json
  x-tenant: retorika
  Origin:    https://asesoriaretorika.com
Body:
  { "email": "alumno@trinitycollege.es" }

Response 200:
  { "ok": true, "isEmpresaInactive": true | false }
```

Lógica: existe `TrainingUser` en `crm_retorika.training_users` con
`type='company'` AND `active=false` → `true`. Cualquier otro caso → `false`.

Si la respuesta es `true`, el WP responde al frontend con
`inactive_empresa: true` y el JS auto-redirige al usuario a la tab
"Registro empresa" del mismo shortcode, pre-rellenando el email.

El check original de `get_user_meta` se mantiene como **segunda
defensa** dentro de `re_register_privado_rest()`, por si el usuario
existe también en WP de un import anterior.

### Auth y rate limit

Modo browser (sin HMAC):
- header `x-tenant: retorika`
- `Origin` o `Referer` con hostname en
  `{asesoriaretorika.com, www.asesoriaretorika.com}`
- rate limit **30 req/min por IP**, key `retorika-check-empresa-user`

Sin HMAC: el shortcode vive en el plugin `code-snippets` público y
no puede llevar el secret. La privacidad se garantiza limitando la
respuesta a un único booleano: ningún dato del `TrainingUser`
(nombre, empresa, NIF…) llega al cliente. La superficie de
enumeración es idéntica a la que un atacante obtendría intentando
el registro privado en masa contra `re_register_privado_rest`.

### Logging

`[retorika:check-empresa-user] email_masked=alb***@trin***.es result=true|false`

Email enmascarado para no introducir PII en stdout (mismo patrón
que el resto de endpoints públicos del módulo).

### Modo browser comparado con `/registro-curso`

| Endpoint | Auth | Rate limit | Razón |
|---|---|---|---|
| `POST /api/webhooks/retorika/registro-curso` (browser) | `x-tenant` + Origin allowlist | 10/min | El POST crea un `CourseRegistration` con payload PII; bucket bajo para frenar bots. |
| `GET /api/webhooks/retorika/registro-curso/check` | **HMAC** sobre query string | 60/min | Lo invoca un snippet PHP en el servidor de WP; el secret vive en `wp-config.php`, nunca en JS público. |
| `POST /api/webhooks/retorika/check-empresa-user` (browser) | `x-tenant` + Origin allowlist | 30/min | Form HTML público; respuesta booleana sin PII. |

### Entregable WP

El snippet PHP completo con el fix integrado está en
`docs/integrations/retorika-shortcode-registro-FIX-alba.php`.
Jorge copia y pega manualmente este archivo en el plugin Code Snippets
del WP de Retorika cuando deploye. **No requiere migración BD ni cambios
adicionales en el VPS más allá del endpoint backend.**

### Smoke

```
node --env-file=.env.local scripts/smoke-retorika-check-empresa.mjs
```

5 casos: empresa inactiva, empresa activa, privado, inexistente,
origin no autorizado. Idempotente (cleanup al final).

### Troubleshooting

| Síntoma | Diagnóstico |
|---|---|
| `isEmpresaInactive=false` para una alumna que sí está como empresa inactiva | (1) Comparar email en bruto vs BD: el hook `beforeSave` del modelo `TrainingUser` lowercasea y trimea; el endpoint hace lo mismo antes de la query. Si en BD hay espacios o mayúsculas previos al hook, el WHERE no matchea — corregir con UPDATE manual o re-import. (2) Verificar `archivedAt IS NULL` — si la alumna fue archivada, sigue siendo `company/false` pero el flujo de re-activación NO debería pasar por el form. |
| Endpoint devuelve 401 desde el shortcode WP | (1) Headers que envía el browser: `x-tenant: retorika` debe ir en minúsculas; `Origin` lo añade automáticamente el browser. (2) Si la página WP se sirve desde un dominio que no está en la allowlist (p. ej. staging), añadirlo al `Set` `ALLOWED_HOSTS` del endpoint. |
| Endpoint devuelve 429 | El rate limit es 30/min por IP, key `retorika-check-empresa-user`. En producción es por IP del nginx; en local todas las llamadas comparten la IP `unknown`. Suele indicar un script de prueba en bucle. |

