# Módulo Documents (#8 Documentación & Contratos)

> Estado: **Sprint 1 (backend + infra + migración) y Sprint 2 (UI) implementados en local, sin desplegar.**
> Módulo genérico: aplica a **todos los tenants activos**.
> Tenants con el módulo activo en local: `demo`, `sandbox` (vía enable-all-tenants).

## Básico vs avanzado (01/08/2026)

Documentos se parte en dos, como Equipo:

| Módulo | Qué incluye |
| --- | --- |
| `documents` | **Básico**: SOLO el Contrato de Prestación de Servicios del centro (subir, reemplazar, descargar). |
| `documents_avanzado` | El **archivo completo**: carpetas, buscador, subida general y cuota. |

- El contrato vive en `/documentos` (arriba del todo), no en Configuración: es
  un documento del centro y ahí es donde lo busca quien lo necesita.
  `GET/POST /api/documents/contrato-servicios` + `/download`, gated al BÁSICO.
- Los endpoints del archivo (`/api/documents`, `folders`, `quota`, `[id]`…)
  exigen `documents_avanzado`. Un cliente con el básico recibe 403: no puede
  listar ni descargar nada que no sea su contrato.
- La lógica del contrato vive en `lib/documents/contratoServicios.js` y la
  comparten DOS puertas: esta y la de la ficha del paciente
  (`/api/pacientes/contract-template`, la de siempre en Aumenta). Es el MISMO
  documento: uno por centro.
- **Por qué existe el básico**: `nutri_laura` no tiene módulo clínico, así que
  no podía subir su contrato por ningún sitio — y sin contrato subido el portal
  no le pide la firma a ninguna familia. Con el básico lo sube ella sola sin
  llevarse de propina un gestor documental que no necesita.

⚠️ **`documents` significa MENOS que antes.** Quien ya lo tenía esperaba el
archivo entero, así que `scripts/migrate-documents-avanzado.js` (ONE_OFF,
idempotente) le añade el avanzado a todo el que tuviera `documents` activo.
Ejecutarlo en el despliegue o alguien se queda sin sus documentos un lunes.

---

Drive básico por tenant: carpetas anidadas (máx 4 niveles), archivos PDF/DOCX/XLSX,
documentos privados por usuario + carpetas/documentos compartidos con el tenant.

---

## 1. Resumen ejecutivo

- **Carpetas** (`document_folders`): árbol self-FK, `level` 0..3 (CHECK), visibilidad
  `private`/`shared`, `owner_user_id` (creador).
- **Documentos** (`documents`): metadatos (nombre, tamaño real, MIME, fecha, autor) +
  `storage_path` relativo; los bytes viven en el volumen `/app/uploads`.
- **ACL**: private = solo el owner ve/edita; shared = todos los usuarios del tenant leen,
  solo el owner borra/renombra. El filtrado es **a nivel de query** (no post-fetch).
- **Límites**: 25 MB/archivo, **1 GB/tenant** (suma real en disco).
- **Seguridad**: MIME por **magic bytes**, nombres saneados + UUID en disco, guards
  anti path-traversal, streaming en download/preview, `AuditLog` en toda mutación.
- **Preview**: PDF inline (con `nosniff` + CSP); DOCX/XLSX solo descarga directa.

Sprint 1 = solo backend. La UI (`/documentos`) es Sprint 2 (la entrada del Sidebar ya
existe: `Sidebar.jsx`, `key:"documents"`, `href:"/documentos"`).

---

## 2. Activación del módulo

No existe catálogo `master.modules`: activar = insertar fila en
`master.tenant_modules` (`module_key='documents'`, `enabled=true`). La key canónica
vive en `lib/tenant/moduleKeys.js` (`MODULE_KEYS.DOCUMENTS`) para evitar typos.

```bash
# 1) Habilitar en TODOS los tenants activos (idempotente + invalidateTenantCache)
npm run db:enable:documents            # local
# 2) Crear las tablas en los tenants habilitados (idempotente, txn por tenant)
npm run db:migrate:documents           # local
```

**Producción (VPS):** el contenedor no lleva `.env.production` pero sí `DATABASE_URL`
por `env_file`, y `db` solo resuelve dentro de la red Docker → NO usar el script `:prod`
con `--env-file`. Ejecutar directamente dentro del contenedor:

```bash
docker exec -it crm-salamandra-app-1 node scripts/enable-documents-all-tenants.js
docker exec -it crm-salamandra-app-1 node scripts/migrate-documents-sprint-1.js
```

> `hasModule("documents")` cruza tenant + `user.moduleAccess`. Al ser genérico, en el
> rollout hay que dar `"documents"` (o wildcard) en el `moduleAccess` de los usuarios,
> o el endpoint responde 403 aunque el tenant lo tenga activo. Ver Backlog.

---

## 3. Arquitectura BD (schema `crm_{slug}`)

### 3.1 `document_folders`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `parent_folder_id` | UUID null | self-FK → `document_folders(id)` **ON DELETE CASCADE**. NULL = raíz |
| `visibility` | ENUM(`private`,`shared`) | — |
| `owner_user_id` | UUID NOT NULL | creador (master.users.id) |
| `name` | VARCHAR(255) | — |
| `level` | INTEGER NOT NULL DEFAULT 0 | **CHECK (0..3)** → máx 4 niveles |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

Índices: `document_folders_dedup_idx` UNIQUE `(parent_folder_id, name, visibility, owner_user_id)`,
`document_folders_owner_vis_idx` `(owner_user_id, visibility)`, `document_folders_parent_idx` `(parent_folder_id)`.

### 3.2 `documents`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | = el UUID del archivo en disco |
| `folder_id` | UUID null | FK → `document_folders(id)` **ON DELETE CASCADE**. NULL = raíz |
| `visibility` | ENUM(`private`,`shared`) | heredada de la carpeta al crear |
| `owner_user_id` | UUID NOT NULL | — |
| `file_name` | VARCHAR(255) | nombre original **saneado** (display + Content-Disposition) |
| `storage_path` | VARCHAR(500) | path relativo a `UPLOADS_ROOT` |
| `file_size` | BIGINT NOT NULL | **bytes reales medidos server-side** (CHECK ≥ 0) |
| `mime_type` | VARCHAR(100) | **CHECK IN (pdf, docx, xlsx)** — no ENUM (labels de enum PG < 63 bytes; los MIME de DOCX/XLSX los superan) |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

Índices: `documents_owner_vis_idx` `(owner_user_id, visibility)`, `documents_folder_idx` `(folder_id)`.

### 3.3 ENUMs / relaciones

- `enum_document_folders_visibility`, `enum_documents_visibility` (`private`,`shared`).
- `documents.mime_type` = VARCHAR + CHECK (ver arriba).
- Asociaciones (lib/db/tenantDb.js): `DocumentFolder.hasMany(DocumentFolder as children)` +
  `belongsTo(as parent)`; `DocumentFolder.hasMany(Document as documents)` + `belongsTo(as folder)`.
- Borrado en cascada: al borrar una carpeta, la FK CASCADE elimina subcarpetas y filas
  de documentos; los **archivos físicos** los borra el endpoint (recorre el subárbol
  antes de borrar y hace `unlink` tras el commit).

---

## 4. Storage layout — `lib/documents/documentStorage.js`

Path relativo (guardado en `documents.storage_path`, con `/`):

```
documents/{tenantSlug}/{ownerUserId | "shared"}/{documentUUID}.{ext}
```

- `UPLOADS_ROOT`: `process.env.UPLOADS_ROOT` (tests) → `/app/uploads` (prod) → `<cwd>/uploads` (dev).
- private → segmento = `ownerUserId`; shared → segmento literal `"shared"`.
- Clonado y generalizado de `lib/clients/attachmentStorage.js` (regla #2: NO reutilizar
  in-place — el de clients está hardcodeado a `.pdf` y a `clients/{clientId}`).
- Funciones: `saveDocumentFile`, `readDocumentStream` (`{stream,size}`, **stat primero**
  → ENOENT antes de la respuesta), `deleteDocumentFile` (idempotente), `getTenantStorageUsage`
  (recorrido de disco), `validateMimeMagicBytes`, `sanitizeFileName`, `isAllowedMime`.

---

## 5. Endpoints REST

Todos con `withTenant` + `hasModule("documents")` + `x-user-id` obligatorio +
`AuditLog` en mutaciones.

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/documents/folders?visibility=&parentFolderId=` | lista por nivel (visibility private/shared/all; sin parent = raíz). Devuelve `documentCount`, `subfolderCount`, `ownerName` |
| POST | `/api/documents/folders` | `{name, visibility, parentFolderId?}`. Valida nivel ≤ 3, dedup, acceso al padre, visibilidad = la del padre |
| GET | `/api/documents/folders/[id]` | detalle + **breadcrumb** |
| PATCH | `/api/documents/folders/[id]` | rename (solo owner) |
| DELETE | `/api/documents/folders/[id]` | solo owner. CASCADE (BD) + borrado físico del subárbol |
| GET | `/api/documents?folderId=&visibility=` | lista de documentos visibles |
| POST | `/api/documents` | multipart `file` + `folderId?` + `visibility?`. Ver validaciones abajo |
| GET | `/api/documents/[id]` | metadatos |
| GET | `/api/documents/[id]/download` | **stream**, `Content-Disposition: attachment`, `nosniff` |
| GET | `/api/documents/[id]/preview` | **solo PDF**, `inline`, `nosniff` + CSP `default-src 'none'; object-src 'self'` (400 si no es PDF) |
| DELETE | `/api/documents/[id]` | solo owner. archivo físico + fila en transacción |
| GET | `/api/documents/quota` | `{usedBytes, limitBytes, usedPercent, usedMB, limitMB}` |

### POST /api/documents — validaciones (en orden)

1. `Content-Length` > 25 MB (+overhead) → **413** (antes de parsear; el runtime rechaza
   cuerpos grandes en `formData()` con un throw genérico → así devolvemos 413 y no un 400).
2. MIME declarado ∉ {pdf, docx, xlsx} → **400**.
3. `buffer.length` > 25 MB → **413** (defensa; medida real).
4. Magic bytes no coinciden con el MIME → **400** (`%PDF-` / ZIP `PK\x03\x04`).
5. Uso del tenant + tamaño > 1 GB → **507**.
6. Acceso a la carpeta destino (private→owner, shared→cualquiera del tenant).
7. Escribe a disco → INSERT BD; si el INSERT falla, borra el archivo (best-effort atómico).

Códigos de estado: 413 (tamaño), 507 (cuota), 400 (tipo/magic/validación), 403 (ACL),
404 (no existe), 201 (creado).

---

## 6. Seguridad

- **MIME real** por magic bytes (no confía en extensión ni Content-Type declarado).
- **Nombre en disco = UUID**; el original saneado (sin control chars ni separadores)
  vive solo en BD. Guards regex por segmento + contención bajo root verificada con
  `path.relative` (sin `path.join`/`path.resolve` sobre el storagePath: el trazador
  NFT de Turbopack trata un join de un string que también pasa por `split()` como
  ruta irresoluble y traza el proyecto entero en `next build` — aviso "Encountered
  unexpected file in NFT list").
- **Streaming** en download/preview (no bufferiza 2× como el legacy de clients).
- **Preview inline** endurecido: `Content-Type: application/pdf` forzado + `nosniff` + CSP
  restrictiva; DOCX/XLSX nunca inline.
- **Aislamiento por tenant**: slug del JWT (no de URL) en el path y en las queries del schema.
- **ACL por usuario** a nivel de query (`visibilityWhere`): private filtra por `ownerUserId`.
- **AuditLog** en `document_folder.{created,updated,deleted}` y `document.{uploaded,deleted}`.

---

## 7. Cuotas y límites

- 25 MB por archivo (`MAX_FILE_SIZE_BYTES`), 1 GB por tenant (`TENANT_QUOTA_BYTES`).
- Cuota = suma **real en disco** del tenant (`getTenantStorageUsage`), comprobada antes de escribir.
- nginx `client_max_body_size` = **30M** en el VPS (ya subido) → deja pasar los 25 MB.

---

## 8. Sprint 1 (cerrado en local) — archivos

- Modelos: `models/tenant/DocumentFolder.model.js`, `models/tenant/Document.model.js` (+ registro en `lib/db/tenantDb.js`).
- Storage: `lib/documents/documentStorage.js`. Helpers/ACL/serializers: `lib/documents/helpers.js`. Constante: `lib/tenant/moduleKeys.js`.
- Endpoints: `app/api/documents/**` (folders, folders/[id], documents, [id], [id]/download, [id]/preview, quota).
- Migración: `scripts/migrate-documents-sprint-1.js`. Enable: `scripts/enable-documents-all-tenants.js`. npm: `db:enable:documents`, `db:migrate:documents` (+ `:prod`).
- Smoke: `scripts/smoke-test-documents.mjs` (`npm run smoke:documents`, 21 checks) — **21/21 OK** en local.

Verificado en local (demo): enable + migración (idempotentes) + smoke completo
(carpetas anidadas, ACL private/shared entre 2 usuarios, subida válida, rechazo de
PPTX/magic-bytes/tamaño/cuota, download stream, preview inline, borrado físico de doc y
cascada de carpeta, AuditLog).

---

## 9. Sprint 2 (implementado) — UI

- `app/(dashboard)/documentos/page.jsx` → `modules/documents/DocumentsModule.jsx`.
- `components/documents/`: `FileTypeIcon.jsx` (badge por MIME), `UploadDropzone.jsx`
  (drag & drop + click, subida 1 a 1), `PdfPreviewModal.jsx` (iframe a `/preview`,
  `top-14 lg:top-0` regla #13).
- `DocumentsModule`: tabs **Privados/Compartidos**, **breadcrumb** de navegación,
  grid de carpetas + lista de archivos, crear/renombrar/borrar carpeta (solo owner),
  subir/descargar/preview/borrar documento (borrar solo owner), **barra de cuota**.
- Verificado en local (demo): render, navegación anidada, subida PDF/DOCX, preview PDF,
  **download/preview de nombre con `€` → 200** (fix del review), tabs, crear carpeta,
  responsive móvil sin overflow. Limpieza sin huérfanos (cuota a 0).

---

## 10. Backlog

- 🔴 nginx: `client_max_body_size 30M` — **ya aplicado** en producción. Sin acción.
- 🟠 Rollout multi-tenant: dar `"documents"` en `user.moduleAccess` de los usuarios de cada
  tenant (o decidir gating por `tenantHasModule` / `always:true` como Configuración). Hoy el
  enable solo inserta la fila de `tenant_modules`.
- 🟠 Attachments legacy (`clients`) sin magic bytes → aplicar `validateMimeMagicBytes`.
- 🟠 Attachments legacy sin ACL por usuario ni AuditLog → aplicar el patrón de Documents.
- 🟠 Attachments legacy bufferizan 2× en el download → migrar a streaming (`readDocumentStream`).
- 🟡 Sidebar gating usa solo tenant-level; la API cruza tenant+user. Documents queda coherente
  con la API; revisar los demás módulos.
- 🟡 `moduleKey` es STRING libre en `tenant_modules`. Documents introduce `MODULE_KEYS`;
  extraer las demás keys del Sidebar y centralizarlas (y usarlas en Sidebar + enable/migrate existentes).
- 🟡 `getTenantStorageUsage` recorre el disco en cada subida — cachear/contar por tenant si crece.
- 🟡 Carrera de cuota: dos subidas concurrentes pueden pasar el check a la vez (aceptable Sprint 1).
- 🟡 Cuota configurable por tenant vía `tenant_modules.featureFlags`/`settings` (algunos querrán > 1 GB).
- 🟡 Backup `uploads/` a `/backups/` con rotación semanal (no Sprint 1).
- 🟡 GC de directorios/archivos huérfanos en `uploads/` (cronjob) — heredado de clients (no Sprint 1).
- 🟡 `UPLOADS_ROOT` (código) vs `UPLOADS_HOST_DIR` (compose): documentado en `.env.production.example`.
- 🟡 Preview DOCX/XLSX server-side (conversión LibreOffice headless) — no Sprint 1.
---

## 11. Revisión adversarial (post-Sprint 1)

Review multi-agente de los endpoints (5 dimensiones × verificación adversarial). Resultado:
9 hallazgos confirmados. **Arreglados y re-verificados:**

- 🔴 **Content-Disposition con nombres no-Latin-1** (€, guiones tipográficos, comillas de
  Word, emoji, CJK) hacía `new Response()` lanzar ByteString → 500 e indescargable. Fix:
  helper `contentDisposition()` con fallback ASCII en `filename="…"` + nombre real en
  `filename*=UTF-8''` (RFC 5987), en download y preview. Verificado con `Factura €500 – 文 🚀.pdf`.
- 🟠 **Borrar carpeta shared destruía documentos de OTROS usuarios** vía CASCADE (bypass del
  "solo el owner borra"). Fix: DELETE de carpeta devuelve **409** si el subárbol contiene
  documentos/subcarpetas de otro `owner_user_id`. Verificado.
- 🟡 `findAll` sin LIMIT → `limit: 1000` en los dos listados (paginación real = Sprint 2 UI).
- 🟡 Dedup de carpeta raíz en carrera (NULL fuera del UNIQUE) → **índice parcial**
  `document_folders_root_dedup_idx WHERE parent_folder_id IS NULL` (modelo + migración).

**Aceptados (riesgo bajo, Sprint 1):**

- Cuota TOCTOU: dos subidas concurrentes pueden pasar el check a la vez (overage acotado).
  Mitigar con reserva/lock o contador por tenant.
- Orphan file si el proceso cae entre `writeFile` y el INSERT (o si el cleanup best-effort
  falla): cuenta para la cuota sin fila en BD → GC de huérfanos (ya en backlog).
- Stream error tras el `stat` (DELETE concurrente durante la descarga): respuesta 200 con
  `Content-Length` mayor que los bytes servidos. Raro; considerar abrir el fd antes de responder.
