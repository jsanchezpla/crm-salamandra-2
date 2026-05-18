# 04 — Formación

14 TCs (TC-053 a TC-066). Cubre el módulo `training`. Documentación
de referencia: `docs/modules/training.md`.

> Algunos TCs requieren tener `RETORIKA_WEBHOOK_SECRET` definido en
> `.env.local`. Si la variable está vacía, los webhooks responden 401
> a todo (es el comportamiento defensivo correcto, pero entonces los
> TCs que requieren firma válida no se pueden completar).

---

### TC-053. Webhook con HMAC válido: 200, datos persistidos

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público (con secret)

**Precondiciones**: Reset, secret HMAC en env.

**Pasos**:
1. Calcular firma:
   ```
   $body = '{"action":"publish","data":{"id":9999,"title":"Curso QA","wc_product_id":777}}'
   $secret = $env:RETORIKA_WEBHOOK_SECRET
   $sig = (& "C:\Program Files\Git\usr\bin\openssl.exe" dgst -sha256 -hmac $secret -hex `
           ([System.Text.Encoding]::UTF8.GetBytes($body) | %{ '{0:X2}' -f $_ }))
   # Mejor usar scripts/test-tutorlms-webhook.js si existe
   ```
2. POST `/api/webhooks/tutorlms/course` con header `X-Retorika-Signature: sha256=<hex>` y `x-tenant: demo`.

**Resultado esperado**:
- HTTP 200.
- En BD: `crm_demo.courses` tiene un nuevo registro con `wpCourseId=9999`.

**Resultado real**: OK — ejecutado vía `node --env-file=.env.local scripts/test-tutorlms-webhook.js` (CASO C). Payload: `{action:"publish", course_id:99999, course_title:"Test webhook firma", wp_course_id:99999}`. Respuesta **HTTP 200** `{"ok":true,"action":"publish","courseId":"1e6cdf4d-0924-45c8-a617-5f6936f3780d"}`. BD: `crm_demo.courses` pasa de 8→9 registros; el nuevo tiene `wp_course_id=99999`, `name="Test webhook firma"`, `active=true`. El id devuelto coincide con el persistido.
**Bug detectado**: ℹ️ informativo — el TC en el doc QA muestra payload con shape `{action, data:{id, title, wc_product_id}}`, pero el endpoint real consume el shape plano `{action, course_id, course_title, wp_course_id}` (el que usa el script de test). Es discrepancia del doc QA, no del código. Actualizar el ejemplo del TC para evitar confusión.

---

### TC-054. Webhook sin firma o con firma falsa: 401

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público

**Pasos**:
1. POST `/api/webhooks/tutorlms/course` sin header `X-Retorika-Signature`.
2. POST con header pero firma incorrecta: `sha256=ffff...`.

**Resultado esperado**:
- Ambos: HTTP 401 "Firma inválida".
- BD sin cambios.

**Resultado real**: OK — `scripts/test-tutorlms-webhook.js`:
- CASO A `/course` sin header `X-Retorika-Signature` → **HTTP 401** `"Firma inválida"`.
- CASO B `/course` con `sha256=deadbeef` → **HTTP 401** `"Firma inválida"`.
- Smoke en los 4 endpoints restantes sin firma → todos **401** (`/enrollment`, `/quiz-attempt`, `/sync`, `/sync-courses`).
- BD: no se creó ningún curso/inscripción/intento adicional por los casos 401 (el contador solo subió por CASO C de TC-053).
**Bug detectado**: ninguno.

---

### TC-055. Webhook con HMAC válido pero tenant sin módulo training: 403

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público

**Pasos**:
1. SQL: desactivar módulo training en demo: `UPDATE master.tenant_modules SET enabled=false WHERE module_key='training' AND tenant_id=(SELECT id FROM master.tenants WHERE slug='demo')`.
2. Invalidar cache (reiniciar dev server, o esperar 60s).
3. POST webhook firmado correctamente con `x-tenant: demo`.
4. Restaurar el módulo: `UPDATE master.tenant_modules SET enabled=true ...`.

**Resultado esperado**:
- 403 antes de cualquier escritura.
- Una vez restaurado, los webhooks vuelven a funcionar (200).

**Resultado real**: OK.
- UPDATE `master.tenant_modules SET enabled=false WHERE module_key='training' AND tenant_id=(SELECT id FROM master.tenants WHERE slug='demo')`.
- Espera 65 s para que caduque el cache de `getTenantContext` (TTL 60 s).
- POST `/api/webhooks/tutorlms/course` con firma válida y `x-tenant: demo` → **HTTP 403** `"Módulo training no activo en este tenant"`. No se persistió nada (el guard `hasModule("training")` rechaza antes del `processCourse`).
- UPDATE `enabled=true`. Espera 65 s.
- POST mismo webhook → **HTTP 200** `courseId=49be7152-a571-41ac-ae88-9c9278b40660`. Restaurado.
**Bug detectado**: ℹ️ operativo — no hay endpoint admin para invalidar el cache de tenant en runtime; cualquier cambio de `tenant_modules.enabled` tarda hasta 60 s en propagarse. En producción significa: tras tocar módulos, esperar ~1 min o reiniciar el proceso. Decisión: dejarlo así (no es un fallo, es un detalle de operación) o exponer endpoint admin con `invalidateTenantCache(slug)`.

---

### TC-056. Webhook quiz-attempt: NO logs con PII en stdout

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico (RGPD)
**Rol necesario**: público

**Pasos**:
1. POST `/api/webhooks/tutorlms/quiz-attempt` con firma válida y body
   con `student_email`, `student_name`, `answers` con respuestas reales.
2. Mirar `npm run dev` console.

**Resultado esperado**:
- NO aparece email ni nombre del alumno ni respuestas en stdout.
- (Verificación documentada: en sprint anterior se eliminaron 5
  console.log con PII).

**Resultado real**: OK por inspección de código (no por inspección de stdout en runtime, ya que el dev server lo controla Jorge). `Grep` en `app/api/webhooks/tutorlms/` no devuelve **ningún** `console.log/info/debug/warn`. En `lib/training/` solo aparece un `console.error` en `webhookAuth.js` línea 24, que loguea exclusivamente "RETORIKA_WEBHOOK_SECRET no configurado" — sin PII. La limpieza del sprint anterior se sostiene.
**Bug detectado**: ninguno.

---

### TC-057. POST /api/training/courses con user no-admin: 403

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead (user)

**Precondiciones**: lead@demo.salamandra activo.

**Pasos**:
1. Login lead.
2. POST `/api/training/courses` con `{name:"Curso QA"}`.

**Resultado esperado**:
- HTTP 403.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-058. POST /api/training/courses con admin: 201

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset.

**Pasos**:
1. Login admin.
2. POST `/api/training/courses` con `{name:"Curso QA admin"}`.

**Resultado esperado**:
- 201, curso creado, aparece en `/formacion/cursos`.

**Resultado real**: OK — login admin via API, `POST /api/training/courses {name:"Curso QA admin TC-058"}` → **HTTP 201**, `data.id=76589e3c-cb79-414c-9629-c8a20bd074b2`. Pendiente confirmación visual en `/formacion/cursos` (Jorge).
**Bug detectado**: ninguno.

---

### TC-059. POST /api/cuestionarios/sync con user no-admin: 403

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead

**Pasos**:
1. Login lead.
2. POST `/api/cuestionarios/sync`.

**Resultado esperado**:
- HTTP 403 "Solo administradores pueden modificar este recurso".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-060. TrainingUser email único: duplicado por API → 409

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Pasos**:
1. SQL: ver email existente, ej. `SELECT email FROM crm_demo.training_users LIMIT 1`.
2. POST a `/api/training/users/import` con un Excel que contenga ese
   email duplicado.

**Resultado esperado**:
- El segundo intento falla (UNIQUE constraint).
- En la respuesta: `errors[]` con la fila que falló.
- Resto de filas válidas se importan.

**Resultado real**: OK funcionalmente, pero comportamiento distinto al esperado. Excel preparado con 3 filas (1 email existente `ana.serrano@tsi.es` + 2 emails nuevos). POST `/api/training/users/import` → HTTP 200 `{"imported":2,"skipped":1,"errors":[]}`. Total en BD: 47 → 49 (delta +2). Fila duplicada no sobreescribe la original. El endpoint usa `findOrCreate`: los duplicados se cuentan en `skipped`, no en `errors[]`. Es **idempotencia silenciosa**, comportamiento mejor que el descrito en el TC.
**Bug detectado**: 🟡 menor (doc QA) — el TC describe "falla por UNIQUE → aparece en errors[]". El código real usa `findOrCreate` y trata duplicados como `skipped`. Actualizar el TC para reflejar el comportamiento real (que es además preferible: no rompe el import cuando hay duplicados).

---

### TC-061. /api/external/retorika/* con API key correcta vs incorrecta

**Módulo**: training
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: público (con API key)

**Precondiciones**: `RETORIKA_API_KEY` definido. Tenant `retorika`
NO existe en local (solo en producción), así que este TC en local
es N/A — los endpoints están hardcodeados a `SLUG = "retorika"`.

**Pasos**:
1. Si en local existe schema `crm_retorika` con datos: probar.
2. Si no: marcar N/A o probar contra producción si hay acceso.
3. Caso A: con `x-api-key: <correcta>` → 200 con datos.
4. Caso B: con `x-api-key: wrong` o sin header → 401.

**Resultado esperado**:
- 200 vs 401 según la key.

**Resultado real**: **N/A en local**. Schema `crm_retorika` no existe en la BD local (solo en producción). Los endpoints `/api/external/retorika/*` están hardcodeados a `SLUG="retorika"`. Validación pendiente para próximo deploy contra producción.
**Bug detectado**: ninguno aplicable en local.

---

### TC-062. /api/cursos-empresas/codigos-cursos/:email — comportamiento

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante (enumeración documentada)
**Rol necesario**: público

**Pasos**:
1. GET `/api/cursos-empresas/codigos-cursos/<email_de_alumno_company>`
   con header `x-tenant: demo`.
2. GET con un email inexistente.

**Resultado esperado**:
- Email existente: array de `wcProductId` de los cursos contratados
  por la empresa del alumno.
- Email inexistente: `[]`.
- Sin auth, solo header `x-tenant`.
- (Documentado en backlog: vector de enumeración).

**Resultado real**: OK. `GET /api/cursos-empresas/codigos-cursos/ana.serrano@tsi.es` (header `x-tenant: demo`, sin auth) → **HTTP 200** `[2001,2002]`. `GET /…/noexiste-qa@nada.test` → **HTTP 200** `[]`. Discriminación clara entre existe / no existe — confirma el vector de enumeración ya documentado en backlog.
**Bug detectado**: ℹ️ recordatorio — el endpoint confirma vector de enumeración (respuestas distintas para email existente vs inexistente, sin auth). Mitigaciones planteadas (auth opcional, rate-limit, respuesta uniforme) pendientes según el backlog del módulo training.

---

### TC-063. /api/usuarios/register/empresa: caso 200 ya activo, caso 200 activación, caso 403

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: público

**Pasos**:
1. POST `/api/usuarios/register/empresa` con `email` de un alumno
   `type='company'` ya `active=true`.
2. POST con email de alumno `type='company'` `active=false` (activarlo
   con SQL primero: `UPDATE crm_demo.training_users SET active=false WHERE email='X'`).
3. POST con email que NO existe.
4. POST con email de alumno `type='private'`.

**Resultado esperado**:
- (1): 200 `{ exists: true, already_active: true }`.
- (2): 200 `{ exists: true, product_ids: [...] }` y `active=true` ahora.
- (3): 403 `{ exists: false }`.
- (4): 403 (no es de empresa).

**Resultado real**: OK. POST `/api/usuarios/register/empresa` (header `x-tenant: demo`, sin auth):
- (1) email de alumno company `active=true` → **HTTP 200** `already_active=true`.
- (2) email tras `UPDATE active=false` → **HTTP 200** `product_ids=[2001,2005,2003]`; BD: `active=true` tras la llamada (re-activado).
- (3) email inexistente → **HTTP 403** `exists=false`.
- (4) email de alumno `type='private'` → **HTTP 403** `exists=false`.
**Bug detectado**: ninguno.

---

### TC-064. Idempotencia de matrículas (CourseEnrollment con UNIQUE)

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: público (webhook)

**Pasos**:
1. POST 2 veces el mismo webhook `/api/webhooks/tutorlms/enrollment`
   con `wp_user_id` y `wp_course_id` idénticos.
2. SQL: `SELECT COUNT(*) FROM crm_demo.course_enrollments
   WHERE training_user_id=... AND course_id=...`.

**Resultado esperado**:
- 2 webhooks → 1 sola fila en `course_enrollments`.
- Ambas respuestas: 200 (idempotencia).

**Resultado real**: OK. 2 × POST `/api/webhooks/tutorlms/enrollment` con `user_id=88888, course_id=88880, user_email=idempot-tc064@qa.test` → ambas **HTTP 200**. BD: 1 fila en `course_enrollments` para ese `training_user_id` × `course_id`. `findOrCreate` actúa de barrera idempotente.
**Bug detectado**: ninguno.

---

### TC-065. Idempotencia de QuizAttempt por wpAttemptId

**Módulo**: training
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: público (webhook)

**Pasos**:
1. POST 2 veces el mismo `/api/webhooks/tutorlms/quiz-attempt` con
   mismo `wp_attempt_id`.

**Resultado esperado**:
- 2 webhooks → 1 sola fila en `quiz_attempts`. La segunda actualiza
  (si los datos cambiaron) o no-op.

**Resultado real**: OK. 2 × POST `/api/webhooks/tutorlms/quiz-attempt` con `attempt_id=77777` (mismos datos) → ambas **HTTP 200**. BD: 1 sola fila en `quiz_attempts WHERE wp_attempt_id=77777`. El endpoint hace `SELECT … FOR UPDATE` (en la práctica, sin transacción explícita pero con UNIQUE en `wp_attempt_id`): la segunda llamada ejecuta `UPDATE` en lugar de `INSERT`.
**Bug detectado**: ninguno.

---

### TC-066. /formacion/* en UI con admin

**Módulo**: training
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Pasos**:
1. Login admin.
2. Visitar:
   - `/formacion` (overview con KPIs y atajos)
   - `/formacion/empresas` (listado y modal "Nueva empresa")
   - `/formacion/empresas/<id>` (detalle, asignar/desasignar cursos)
   - `/formacion/cursos`
   - `/formacion/usuarios`
   - `/formacion/alumnos`
   - `/formacion/cuestionarios`
3. Verificar que `/cuestionarios` redirige a `/formacion/cuestionarios`.

**Resultado esperado**:
- Todas las páginas cargan.
- Datos cuadran con el seed (4 empresas, 8 cursos, 46 alumnos, 77
  matrículas, 55 intentos quiz).

**Resultado real**: ⏳
**Bug detectado**: ⏳
