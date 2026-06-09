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
Lee `process.env.RETORIKA_WEBHOOK_SECRET` en runtime, falla ruidoso
si no está configurado y devuelve `false` ante cualquier firma.

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

| Ruta | Auth alternativa | Riesgo |
| --- | --- | --- |
| `GET /api/external/retorika/alumnos` | API key `x-api-key` | Bajo (key en env). Devuelve **todos los alumnos** del tenant retorika. |
| `GET /api/external/retorika/alumnos/:email` | API key | Bajo. |
| `GET /api/external/retorika/cursos` | API key | Bajo. |
| `GET /api/cursos-empresas/codigos-cursos/:email` | Solo header `x-tenant` | **Medio**. Permite enumerar emails y mapear `wcProductId` por alumno. Sin auth. |
| `POST /api/usuarios/register/empresa` | Solo header `x-tenant` | **Medio**. Permite enumerar emails de tipo `company` (distingue 403 vs 200) y activar el flag `active` sin más validación que el email. CORS abierto. |

Los tres primeros tienen `const SLUG = "retorika"` hardcodeado:
ignoran cualquier `x-tenant` que llegue y consultan siempre la BD del
tenant `retorika`. Aceptable como MVP cliente único; no escala si en
el futuro otro tenant quiere API externa con el mismo formato.

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
| `DELETE /api/training/courses/[id]` | **Hard delete**. | Solo admin/superadmin. |

No hay `GET /api/training/courses/[id]` individual; el detalle se
obtiene del listado.

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
| `GET /api/training/users` | Lista paginada con filtros `type`, `companyId`, `search`. | `hasModule(...)` |
| `POST /api/training/users/import` | Carga masiva desde Excel. Resuelve empresa por nombre o `externalId`. Auto-detecta `type` (con companyId → `company`, sin → `private`). Default `active`: `false` para `type=company` (pre-aprobado, pendiente de activación vía `register/empresa`); `true` para `type=private`. | Solo admin/superadmin. |
| `GET /api/training/users/export` | Excel con todos los usuarios filtrados. | `hasModule(...)` |

**No hay POST individual, ni GET[id], ni PATCH, ni DELETE** de
`TrainingUser`. Toda gestión individual pasa por import + edición
manual de BD. Para activar a un empleado de empresa el flujo es
`POST /api/usuarios/register/empresa` (activa + materializa
matrículas a partir de `company_courses`, ver "Flujo end-to-end de
pre-aprobación de usuarios empresa" más arriba). Para desactivar hay
que tocar BD a mano.

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
| `GET /api/training/quiz-attempts` | Listado paginado. Filtros `search`, `empresa`, `result`, `courseId`. Excluye `answers` para aligerar. | `hasModule(...)` |
| `GET /api/training/quiz-attempts/[id]` | Detalle con `answers` JSONB completo. | `hasModule(...)` |

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
Hoy solo `nutri_laura` tiene override propio (copy nutricional, sin
secciones "Empresas" ni "Cuestionarios" mientras Laura no active B2B
ni conecte TutorLMS). Las páginas internas (`/formacion/cursos`,
`/formacion/usuarios`, etc.) son comunes a todos los tenants.

| Ruta | Función |
| --- | --- |
| `/formacion` | Overview con métricas (empresas, cursos, usuarios, matrículas) y accesos rápidos a las 5 sub-secciones. |
| `/formacion/empresas` | Listado de empresas + modal "Nueva empresa". |
| `/formacion/empresas/[id]` | Detalle de empresa con asignación/desasignación de cursos. |
| `/formacion/cursos` | Listado simple de cursos. Sin alta desde la UI (los cursos se sincronizan desde WP). |
| `/formacion/usuarios` | Listado de `TrainingUser` con filtros y carga Excel. |
| `/formacion/alumnos` | Listado de matrículas (`CourseEnrollment`). |
| `/formacion/cuestionarios` | Listado de intentos. Renderiza `modules/cuestionarios/CuestionariosModule.jsx`. |
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
| `scripts/add-training-module-nutri-laura.js` | Activa el módulo `training` en `nutri_laura`. Crea las 6 tablas con SQL crudo (sin la legacy `trainings`), registra el módulo con `uiOverride: nutri-laura/FormacionOverview` y siembra 3 cursos de nutrición. Patrón idéntico al `add-leads-module-nutri-laura.js` por la filosofía de tenant minimal. |
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
