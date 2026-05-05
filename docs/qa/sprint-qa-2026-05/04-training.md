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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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

**Resultado real**: ⏳
**Bug detectado**: ⏳

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
