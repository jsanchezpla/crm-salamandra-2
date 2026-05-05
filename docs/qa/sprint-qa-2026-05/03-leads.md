# 03 — Leads / Comercial

12 TCs (TC-041 a TC-052). Cubre el módulo `leads`. Documentación de
referencia: `docs/modules/leads.md`.

---

### TC-041. Alta de lead manual (admin)

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: Reset (seed creó 35 leads).

**Pasos**:
1. Login admin. Ir a `/leads`.
2. Verificar 35 leads del seed (override demo).
3. Si hay form de "+ Lead", crearlo manual con name, email, motivo.

**Resultado esperado**:
- Listado: 35 leads sembrados visibles.
- Alta manual: 201, lead añadido.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-042. Lead vía endpoint público sin auth

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: público

**Precondiciones**: Reset.

**Pasos**:
1. Logout.
2. POST con curl:
   ```
   curl.exe -X POST http://localhost:3000/api/public/leads \
     -H "x-tenant: demo" -H "Content-Type: application/json" \
     -d '{"name":"Lead público QA","email":"qa@public.test","mensaje":"prueba"}'
   ```
3. Login admin → `/leads`. Verificar que aparece.

**Resultado esperado**:
- 201 sin auth.
- Aparece con `source: null` o tal cual.
- CORS permite peticiones desde cualquier origen.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-043. Lead duplicado por email — comportamiento

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟡 cosmético (documentado: NO se valida unicidad)
**Rol necesario**: admin / público

**Precondiciones**: TC-042.

**Pasos**:
1. POST `/api/public/leads` con el mismo email del TC-042.
2. Verificar que se crea otro lead.
3. SQL: `SELECT email, COUNT(*) FROM crm_demo.leads GROUP BY email HAVING COUNT(*) > 1`.

**Resultado esperado**:
- Permitido: HTTP 201, segundo lead creado.
- Documentado en docs/modules/leads.md: no hay validación de unicidad
  de email en leads.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-044. Cambio de stage por admin: incluye stages no estándar

**Módulo**: leads
**Severidad esperada del bug si falla**: 🔴 crítico (era BUG resuelto)
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. Drawer/edición de un lead. Cambiar stage a `in_progress`. Guardar.
2. Recargar y verificar persistencia.
3. Probar también con `demo_scheduled`, `closed_yes`, `closed_no`.

**Resultado esperado**:
- Los 12 stages aceptados (`ALLOWED_STAGES` en lib/leads/stages.js).
- Cambios persistidos.
- Si se intenta un stage fuera de la lista (ej. `random_stage`), se
  ignora silenciosamente (PATCH solo reemplaza si la clave es válida).

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-045. Cambio de stage por user no-admin: 403

**Módulo**: leads
**Severidad esperada del bug si falla**: 🔴 crítico
**Rol necesario**: lead (user)

**Precondiciones**: TC-041.

**Pasos**:
1. Login `lead@demo.salamandra`.
2. Intentar PATCH con curl:
   ```
   curl.exe -b /tmp/c.txt -X PATCH http://localhost:3000/api/leads/<id> \
     -H "Content-Type: application/json" -d '{"stage":"contacted"}'
   ```

**Resultado esperado**:
- HTTP 403 "Solo administradores pueden modificar/importar leads".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-046. Importación desde Excel: estructura y comportamiento ante duplicados

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. GET `/api/leads/import/template` → descargar plantilla.
2. Rellenar 3 filas válidas + 1 fila sin email/phone/name (debe
   skipearse).
3. POST a `/api/leads/import/excel` con multipart/form-data.
4. Verificar JSON de respuesta: `imported`, `skipped`, `errors[]`.

**Resultado esperado**:
- Plantilla con cabeceras + ejemplo + helpers en gris.
- 3 filas válidas → imported = 3.
- 1 fila vacía → skipped = 1.
- Filas con stage legible ("Demo agendada") se mapean al canónico
  (`demo_scheduled`).

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-047. Exportación: columnas y orden correctos

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. GET `/api/leads/export` (o botón Exportar en `/leads`).
2. Abrir el `.xlsx`.

**Resultado esperado**:
- Una hoja "Leads".
- Cabeceras en verde Salamandra (#1B3A2D).
- Filas alternas grises.
- Stages traducidos al castellano (STAGE_LABELS).
- Nombre de fichero: `leads_AAAA-MM-DD.xlsx`.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-048. Conversión a cliente existente

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante (legacy override spain-enzymes)
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. En el override demo: NO existe esta funcionalidad (documentada:
   "spain-enzymes hace conversión parcial; el resto no").
2. Si existe en el override demo: probar el flujo "Aceptar lead →
   crear cliente".
3. Si no: marcar N/A.

**Resultado esperado**:
- En demo: probablemente N/A. Documentar.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-049. Conversión a Proyecto preserva stage si terminal positivo

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. Lead A en stage `qualified`. Endpoint `POST /api/leads/[id]/convert-to-project`.
2. Lead B en stage `won` (o crear uno y modificarlo). POST mismo endpoint.
3. Lead C en stage `closed_yes`. POST mismo endpoint.

**Resultado esperado**:
- A: stage cambia a `won` automáticamente (no era terminal positivo).
- B: stage queda en `won` (terminal positivo, preserva).
- C: stage queda en `closed_yes`.
- Los 3 leads tienen `convertedProjectId` y `convertedToProjectAt`.
- Los 3 proyectos creados con clientId del lead, status `active`.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-050. Re-conversión del mismo lead a proyecto: 422

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟠 importante
**Rol necesario**: admin

**Precondiciones**: TC-049 ejecutado al menos una vez.

**Pasos**:
1. POST de nuevo `/api/leads/[id]/convert-to-project` sobre un lead
   ya convertido.

**Resultado esperado**:
- HTTP 422 (ValidationError) "Este lead ya está convertido en proyecto".

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-051. Lead con convertedProjectId: enlace "Ver proyecto" en lugar de botón

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-049.

**Pasos**:
1. Drawer del lead convertido (ej. el del seed: "Pablo Mora Aguilar"
   vinculado a PRY-2026-0001).
2. Verificar UI.

**Resultado esperado**:
- En lugar de botón "Convertir a proyecto" aparece enlace "Ver proyecto"
  → navega a `/proyectos/[id]`.

**Resultado real**: ⏳
**Bug detectado**: ⏳

---

### TC-052. Filtros y búsqueda en /leads (override demo)

**Módulo**: leads
**Severidad esperada del bug si falla**: 🟡 cosmético
**Rol necesario**: admin

**Precondiciones**: TC-041.

**Pasos**:
1. Filtrar por `stage = "new"`. Verificar 16 leads (override demo).
2. Filtrar por `stage = "contacted"`. Verificar 14.
3. Filtrar por `stage = "lost"`. Verificar 5.
4. Filtrar por `motivo = "diagnostico"`. Verificar conteo.
5. Búsqueda por nombre con debounce.

**Resultado esperado**:
- Conteos coinciden con seed.
- Búsqueda con `iLike` sobre `name`, `email`, `phone`, `title`.
- Solo 1 request tras debounce.

**Resultado real**: ⏳
**Bug detectado**: ⏳
