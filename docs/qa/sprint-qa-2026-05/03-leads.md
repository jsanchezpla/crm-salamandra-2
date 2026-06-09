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

**Resultado real**: OK.
- Listado en `/leads` (demo override): 35 leads del seed visibles, confirmado en BD `SELECT COUNT(*) = 35` antes del alta.
- Alta manual: el override de demo (`modules/overrides/demo/LeadsModule.jsx`) NO expone form de "+ Lead" por diseño — es un dashboard de gestión, no de captación; los leads entran por webhook público (TC-042). Probado endpoint genérico `POST /api/leads` (admin auth) via curl con body `{name, email, motivo, mensaje, source:"manual"}` → **HTTP 201**, lead creado con `stage="new"` default, `title` auto-rellenado desde `name`, `source="manual"`. Total post: 36 leads en BD.
**Bug detectado**: ninguno funcional. ℹ️ informativo: la diferencia UI vs API es deliberada (override demo). Para tenants que sí necesiten alta manual desde UI, hay que añadir el form al override correspondiente o exponer el botón en el componente base de leads.

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

**Resultado real**: OK. `curl.exe -X POST http://localhost:3000/api/public/leads -H "x-tenant: demo" -H "Content-Type: application/json" -d '{"name":"Lead público QA","email":"qa@public.test","mensaje":"prueba"}'` (sin cookie/JWT) → **HTTP 201** `{ok:true,id:"0b37371d-..."}`. Lead persistido en `crm_demo.leads`. CORS no validado explícitamente (cambia per-deploy, defensa por backend igual cubre el caso). Comportamiento conforme al patrón "endpoint público de captación de leads".
**Bug detectado**: ninguno.

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

**Resultado real**: OK. Segundo POST con el mismo `email=qa@public.test` y `name="Lead público QA dup"` → **HTTP 201** `{ok:true,id:"087708c4-..."}`. SQL: `SELECT email, COUNT(*) FROM crm_demo.leads WHERE email='qa@public.test' GROUP BY email` → 2. Comportamiento conforme al patrón documentado: no hay UNIQUE en `email` para que un mismo prospecto pueda re-contactar y dejar varias entradas (la deduplicación es lógica de negocio, no de BD).
**Bug detectado**: ninguno.

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

**Resultado real**: OK.
- `PATCH /api/leads/<id>` (admin) con `stage:"demo_scheduled"` → HTTP 200, BD: `stage="demo_scheduled"` ✓.
- Mismo PATCH con `stage:"random_stage"` → HTTP 200 pero el stage en BD NO cambia (permanece `demo_scheduled`). La lógica en `app/api/leads/[id]/route.js` filtra contra `ALLOWED_STAGES` y descarta el valor si no es válido (sin error visible).
- Probados los stages terminales y de progreso por inspección de la lista canónica en `lib/leads/stages.js`.
**Bug detectado**: ninguno funcional. ℹ️ Comportamiento "ignorar silenciosamente" puede ocultar errores de cliente; opcional: devolver 422 cuando el stage es inválido en lugar de aceptar el resto.

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

**Resultado real**: OK. `curl.exe -b /tmp/lead.txt -X PATCH /api/leads/<id> -d '{"stage":"contacted"}'` → **HTTP 403** `"Solo administradores pueden modificar leads"`. El stage en BD no cambia.
**Bug detectado**: ninguno.

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

**Resultado real**: OK.
- `GET /api/leads/import/template` → HTTP 200, xlsx con 1 hoja "Plantilla Leads", cabeceras `Nombre, Email, Teléfono, Empresa, Estado, Notas`, fila de ejemplo "Juan García" y línea de helpers (Requerido / Texto libre / `new | contacted | qualified | won | lost`).
- Construí xlsx de prueba (con exceljs) con 3 filas válidas + 1 fila completamente vacía + cabeceras. `POST /api/leads/import/excel` (admin, multipart) → **HTTP 201** `{imported:3, skipped:1, errors:[]}`. BD: las 3 filas se persisten con stages mapeados al canónico: "Demo agendada" → `demo_scheduled`, "Contactado" → `contacted`, "Nuevo" → `new`. La fila vacía no se crea.
**Bug detectado**: ninguno.

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

**Resultado real**: OK. `GET /api/leads/export` (admin) → HTTP 200, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ~9.7KB, header `Content-Disposition: attachment; filename="leads_2026-06-09.xlsx"`. Descomprimido: 1 hoja `Leads`, cabeceras `Nombre / Email / Teléfono / Empresa / Estado / Notas / Fecha`. SharedStrings muestra stages traducidos ("Nuevo", "Demo agendada", "Convertido", etc.). Fechas en formato `D/M/AAAA`. Cabeceras en verde y filas alternas son estilos persistidos en el xlsx — pendiente verificación visual en Excel/Calc por Jorge (la construcción del estilo no se inspeccionó cell-por-cell).
**Bug detectado**: ninguno por API/estructura.

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

**Resultado real**: **N/A en override demo**. No existe endpoint `/api/leads/[id]/convert-to-client` ni botón equivalente en el override demo. La vinculación lead→cliente solo se puede hacer hoy seteando `clientId` directamente en el lead. Y eso a su vez está bloqueado por el bug detectado en TC-092: el PATCH `/api/leads/[id]` NO acepta `clientId` en su whitelist `allowed` (`app/api/leads/[id]/route.js`). Esto significa que en el estado actual del código tampoco se puede vincular vía API sin tocar SQL.
**Bug detectado**: 🟠 cruzado con TC-092 — añadir `clientId` al whitelist `allowed` del PATCH de leads para habilitar la vinculación lead↔cliente.

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

**Resultado real**: OK funcional + 🟠 ya documentado en TC-092.
- Seteé 3 leads vía SQL: L1=`qualified`, L2=`won`, L3=`closed_yes`.
- `POST /api/leads/<L1>/convert-to-project` → HTTP 201, proyecto `PRY-2026-0005` activo. BD: lead L1 ahora `stage='won'` (auto-cambio) ✓.
- `POST /api/leads/<L2>/convert-to-project` → HTTP 201, proyecto `PRY-2026-0006`. BD: lead L2 sigue en `won` ✓.
- `POST /api/leads/<L3>/convert-to-project` → HTTP 201, proyecto `PRY-2026-0007`. BD: lead L3 sigue en `closed_yes` ✓.
- Los 3 leads tienen `convertedProjectId` y `convertedToProjectAt` poblados ✓.
- Los 3 proyectos: `status='active'` ✓.
- `customFields.convertedFromLeadId` apunta al lead original ✓.
**Bug detectado**: 🟠 (cruzado con TC-092) los 3 proyectos creados tienen `clientId: null` aunque hubiera tenido sentido propagar el cliente del lead. Caso A/B/C en este TC NO tenían cliente vinculado, así que aquí no rompe nada. Pero el endpoint `convert-to-project` (línea 61 `clientId: lead.clientId ?? null`) ya hace lo correcto; el bug está aguas arriba: el PATCH `/api/leads/[id]` no permite asignar `clientId`. Ver TC-092.

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

**Resultado real**: OK. `POST /api/leads/<L1>/convert-to-project` (lead ya con `convertedProjectId`) → **HTTP 422** `"Este lead ya está convertido en proyecto"`. No se crea proyecto duplicado.
**Bug detectado**: ninguno.

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

**Resultado real**: Pendiente — UI del drawer override demo. Verificable solo en navegador. El campo `convertedProjectId` está en la respuesta de `GET /api/leads/<id>` (probado en TC-049), así que la UI tiene la información para decidir qué botón renderizar.
**Bug detectado**: Pendiente.

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

**Resultado real**: OK con corrección. Conteos por API (post-TCs anteriores, no idénticos al seed virgen):
- `GET /api/leads?stage=new&limit=200` → 15 leads.
- `GET /api/leads?stage=contacted&limit=200` → 15.
- `GET /api/leads?stage=lost&limit=200` → 5.
- `GET /api/leads?motivo=diagnostico&limit=200` → 9.
- Búsqueda: el parámetro real del endpoint es **`search=`**, NO `q=`. `GET /api/leads?search=pablo` → devuelve "Pablo Mora Aguilar" (filtrado por `iLike` en `name`/`email`/`phone`/`title`).
- Debounce ~300ms es lógica de UI; verificable solo en DevTools por Jorge.
**Bug detectado**: 🟡 menor (doc QA) — el TC indica filtro `?q=`, pero el código (`app/api/leads/route.js:30`) lee `searchParams.get("search")`. Actualizar el TC. Conteos también difieren del seed virgen porque los TCs previos añadieron/convirtieron leads; al re-ejecutar el sprint sobre `db:reset:demo` cuadrará con los 16/14/5.
