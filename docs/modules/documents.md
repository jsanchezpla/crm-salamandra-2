# Módulo Documents (#8 Documentación & Contratos)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `documents` (básico: SOLO el Contrato de Prestación de Servicios) · requiere `citas` y `clients` (`lib/provisioning/catalogo.js`: sin área privada nadie lo firma) · `documents_avanzado` (el archivo completo: carpetas, buscador, subida, cuota) · requiere `documents` · claves en `lib/tenant/moduleKeys.js` (`MODULE_KEYS.DOCUMENTS`, `MODULE_KEYS.DOCUMENTS_AVANZADO`) |
| **Reina** | — (ninguna declarada en el doc ni en el código; el básico nació para `nutri_laura`, que no podía subir su contrato) |
| **Pantallas** | `app/(dashboard)/documentos/page.jsx` → `/documentos` (server component: mira `documents_avanzado` en master y pasa `avanzado`; con el básico solo se ve la tarjeta del contrato) · el mismo archivo `documents` se asoma desde otras fichas: pestaña Documentos de `/clientes/[id]` (`components/clients/ClientAttachmentsPanel.jsx`, montada según `lib/clients/piezasFicha.js`: se ESCONDE si hay `documents_avanzado`) y documentos del paciente en `/pacientes/[id]` |
| **Endpoints** | `app/api/documents/**` — 9 `route.js`: `contrato-servicios/route.js` y `contrato-servicios/download/route.js` exigen `documents` (básico); `route.js`, `[id]`, `[id]/download`, `[id]/preview`, `folders`, `folders/[id]` y `quota` exigen `documents_avanzado` · otras puertas al mismo archivo, gateadas por SU módulo y no por este: `app/api/clients/[id]/attachments/**` (3, `source='ficha'`), `app/api/clients/[id]/contract/**` (3), `app/api/pacientes/[id]/documents/**` (3, `source='paciente'`), `app/api/pacientes/contract-template/**` (2: la misma `contratoServicios.js` desde el módulo clínico), `app/api/team/me/documents/**` (2) · públicos: `app/api/public/c/[tenantSlug]/citas-portal/documents/**` (2) y `.../citas-portal/contract/**` (3), el área privada del paciente, gateados por `citas` |
| **Lógica** | `lib/documents/`: `documentStorage.js` (disco `documents/{slug}/{owner\|shared}/{uuid}.{ext}`, magic bytes, 25 MB por fichero y 1 GB por tenant, `UPLOADS_ROOT`), `helpers.js` (ACL `visibilityWhere`, serializers, auditoría best-effort), `contratoServicios.js` (el contrato del centro: fila de `documents` con `source='contract_template'`, compartida con `/api/pacientes/contract-template`), `contratoFirmadoPdf.js` (la copia PDF de quien firma, pdfkit + Poppins), `contratoFirmadoArchivo.js` (mete ese PDF firmado en el archivo) · `lib/tenant/moduleKeys.js` (las claves) · `lib/clients/piezasFicha.js` (`documents_avanzado` esconde el panel Documentos de la ficha) · el storage se clonó de `lib/clients/attachmentStorage.js` en vez de reutilizarlo (regla #2) |
| **UI** | `modules/documents/DocumentsModule.jsx` (recibe `avanzado`; tabs Privados/Compartidos, breadcrumb, cuota) · `components/documents/`: `ContratoServiciosCard.jsx` (lo único del básico), `UploadDropzone.jsx`, `FileTypeIcon.jsx`, `PdfPreviewModal.jsx` (`top-14 lg:top-0`, regla #13) · menú: `components/layout/Sidebar.jsx` (`key: "documents"`, `/documentos`) |
| **Modelos** | `models/tenant/DocumentFolder.model.js` (`document_folders`: árbol de hasta 4 niveles, `visibility`, `owner_user_id`) · `models/tenant/Document.model.js` (`documents`: el ARCHIVO CENTRAL del CRM desde el 23/07/2026 — MIME libre, `client_id`, `patient_id`, `source` (`manual` / `ficha` / `paciente` / `contract_template`…), `client_visible`, `uploaded_by_client`) · asociaciones en `lib/db/tenantDb.js` |
| **Interruptores y parámetros** | ninguno que lea el código (ni `hasFeatureFlag` ni `getLogicOverride` en `app/api/documents/**` ni en `lib/documents/`). Los límites son constantes de `documentStorage.js` (`MAX_FILE_SIZE_BYTES`, `TENANT_QUOTA_BYTES`); la «cuota por tenant vía featureFlags» del backlog no existe |
| **Pantallas propias** | ninguna (`app/(dashboard)/documentos/page.jsx` no tiene mapa `UI_OVERRIDES`; en producción el letrero `ui_override` no tiene ninguna fila de documents) |
| **Scripts** | activar: `node scripts/enable-module.js <slug> documents` (o `documents_avanzado`; las dos claves comparten las cinco migraciones que declara `scripts/_module-migrations.js`) · migraciones vivas, en orden: `migrate-documents-sprint-1.js` (tablas), `migrate-documents-client-link.js` (`client_id`), `migrate-documents-transversal.js` (archivo central: MIME libre, `source`), `migrate-documents-patient-link.js` (`patient_id`), `migrate-documents-client-portal.js` (`client_visible`, `uploaded_by_client`) · MASTER one-off: `migrate-documents-avanzado.js` (reparte básico/avanzado; idempotente) · datos, a mano: `_hechos/migrate-attachments-to-documents.js` (adjuntos viejos → archivo central), `migrate-contract-patient-to-client.js` (`--confirm`), `seed-contrato-tunutrilaura.js` (clausulado de Laura en `contract_templates`) · histórico: `_hechos/enable-documents-all-tenants.js` (da `documents` a TODOS los tenants; anterior a `enable-module.js` y al reparto básico/avanzado; sigue detrás de `npm run db:enable:documents`) |
| **Pruebas** | `smoke-test-documents.mjs` (servidor + base de datos; 21 checks del archivo; entra en `npm run test:todo` y en `npm run smoke:documents`) · `_smoke-contrato-estructurado.mjs` (base de datos; usa `lib/documents/contratoFirmadoPdf.js`) · `_smoke-piezas-ficha.mjs` (`@prueba ligera`, en `npm test`: con `documents_avanzado` la ficha no monta su panel Documentos) · `_smoke-pdf-contrato.mjs` (`node:test`, `@prueba ligera`, 21/08/2026, en `npm test`; 43 comprobaciones): abre el PDF que devuelve `lib/documents/contratoFirmadoPdf.js` y lo lee **por dentro** —descomprime los flujos y traduce los glifos con el CMap `/ToUnicode` que pdfkit ya mete en el propio documento—, así que comprueba el TEXTO y no el tamaño, que era lo único que se miraba antes (un PDF de 20 KB con el clausulado equivocado pesa exactamente lo mismo que uno con el bueno). Fija: el clausulado ÍNTEGRO de los bloques aceptados y **ninguno** de los que no se aceptaron, los datos declarados que se imprimen, la traza de la firma (fecha clavada a Europe/Madrid, IP, navegador, versión del documento), un pie del centro por página y ni uno de más en un documento de varias, y que ni un PNG corrupto ni una plantilla a medias dejan a nadie sin su copia. También fija `contratoPdfFilename`. |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` (`documents.client_id`) · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` (`documents` en nutri_laura: el tenant lo tenía y su usuaria no lo veía) · `../decisions/2026-08-18-la-piramide-invertida-de-leads.md` (el panel Documentos de la ficha pasa a `components/clients/` y lo decide `documents_avanzado`) |
| **En este doc** | «Básico vs avanzado (01/08/2026)» · «2. Activación del módulo» · «3. Arquitectura BD (schema `crm_{slug}`)» · «4. Storage layout — `lib/documents/documentStorage.js`» · «5. Endpoints REST» · «6. Seguridad» · «9. Sprint 2 (implementado) — UI» · «11. Revisión adversarial (post-Sprint 1)» |

> Estado: **en producción.** Foto de `master` del 19/08/2026: `documents` en
> seis tenants —`aumenta`, `demo`, `demo_clinica`, `demo_nutricion`,
> `nutri_laura` y `somos`— y `documents_avanzado` en tres de ellos (`aumenta`,
> `demo`, `somos`); `nutri_laura` solo el básico, que nació para ella. La foto
> del día, en `/admin/modulos` o `node scripts/inspect-tenant-modules.js <slug>`.
>
> **Histórico (hasta 07/2026):** «Sprint 1 (backend + infra + migración) y
> Sprint 2 (UI) implementados en local, sin desplegar. Tenants con el módulo
> activo en local: `demo`, `sandbox` (vía enable-all-tenants)». `sandbox` ya
> no existe en ningún entorno.

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

Drive básico por tenant: carpetas anidadas (máx 4 niveles), archivos de cualquier
tipo (desde el 23/07/2026; antes solo PDF/DOCX/XLSX), documentos privados por
usuario + carpetas/documentos compartidos con el tenant. Y, desde esa misma
fecha, **el archivo central del CRM**: los adjuntos de la ficha, los documentos
del paciente y el contrato del centro son filas de la misma tabla `documents`
(columna `source`).

---

## 1. Resumen ejecutivo

- **Carpetas** (`document_folders`): árbol self-FK, `level` 0..3 (CHECK), visibilidad
  `private`/`shared`, `owner_user_id` (creador).
- **Documentos** (`documents`): metadatos (nombre, tamaño real, MIME, fecha, autor) +
  `storage_path` relativo; los bytes viven en el volumen `/app/uploads`.
- **ACL**: private = solo el owner ve/edita; shared = todos los usuarios del tenant leen,
  solo el owner borra/renombra. El filtrado es **a nivel de query** (no post-fetch).
- **Límites**: 25 MB/archivo, **1 GB/tenant** (suma real en disco).
- **Seguridad**: MIME por **magic bytes** en los tipos que se saben verificar
  (PDF/OOXML), nombres saneados + UUID en disco, guards anti path-traversal,
  streaming en download/preview, `AuditLog` en toda mutación.
- **Preview**: PDF inline (con `nosniff` + CSP); lo demás solo descarga directa.

**Histórico (hasta 07/2026):** Sprint 1 = solo backend y la UI (`/documentos`)
era Sprint 2. Hoy los dos están en producción; la entrada del Sidebar es
`key:"documents"`, `href:"/documentos"`.

---

## 2. Activación del módulo

No existe catálogo `master.modules`: activar = fila en `master.tenant_modules`
(`module_key='documents'` o `'documents_avanzado'`, `enabled=true`). Las keys
canónicas viven en `lib/tenant/moduleKeys.js` (`MODULE_KEYS.DOCUMENTS`,
`MODULE_KEYS.DOCUMENTS_AVANZADO`) para evitar typos.

**La vía, desde el 01/08/2026**: `enable-module.js`, que abre las DOS puertas
(la fila de `tenant_modules` y el `module_access` de los admin), corre las
**cinco** migraciones que las dos claves declaran en
`scripts/_module-migrations.js` (`migrate-documents-sprint-1`,
`-client-link`, `-transversal`, `-patient-link`, `-client-portal`) e invalida
la caché del tenant:

```bash
# Local
node --env-file=.env.local scripts/enable-module.js <slug> documents            # básico: solo el contrato
node --env-file=.env.local scripts/enable-module.js <slug> documents_avanzado   # el archivo completo (exige el básico)

# Producción: dentro del contenedor (las vars vienen del entorno Docker)
docker exec -it crm-salamandra-app-1 node scripts/enable-module.js <slug> documents_avanzado
```

Y después `npm run db:check-access` para comprobar que los usuarios lo ven:
`hasModule("documents")` cruza tenant + `user.moduleAccess`, y el 01/08 el
tenant de nutri_laura lo tenía y su usuaria no lo veía (ver
`../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md`). Los usuarios
normales se dan con `--grant-users`.

> **Histórico (hasta 01/08/2026):** se hacía en dos pasos,
> `scripts/_hechos/enable-documents-all-tenants.js` (activar en TODOS los tenants) +
> `scripts/migrate-documents-sprint-1.js` (solo las tablas). Siguen existiendo
> detrás de `npm run db:enable:documents` y `db:migrate:documents`, pero el
> primero es anterior al reparto básico/avanzado y el segundo deja cuatro
> migraciones sin correr. Sus variantes `:prod` llevan
> `--env-file=.env.production`, que **no vale en el VPS**: el contenedor no
> tiene ese fichero (las vars van por `env_file` de compose) y `db` solo
> resuelve dentro de la red Docker.

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
| `mime_type` | VARCHAR(150) NOT NULL | **libre desde el 23/07/2026** (`migrate-documents-transversal` lo ensancha y quita el CHECK). **Histórico:** VARCHAR(100) con CHECK IN (pdf, docx, xlsx) — no ENUM porque los labels de enum PG < 63 bytes y los MIME de DOCX/XLSX los superan |
| `client_id` | UUID null → `clients(id)` ON DELETE SET NULL | PARA QUIÉN es el documento (23/07/2026, `migrate-documents-client-link`); `owner_user_id` ya dice quién lo subió. Lo que hace que la ficha del cliente vea sus documentos |
| `patient_id` | UUID null → `patients(id)` (FK solo si existe la tabla) | paciente concreto (24/07/2026, `migrate-documents-patient-link`): un pagador puede tener varios hermanos |
| `source` | VARCHAR(40) NOT NULL DEFAULT `'manual'` | de dónde vino: `manual` (el módulo), `ficha` (adjunto de la ficha), `paciente`, `contract_template` (el contrato del centro), `contrato` / `contrato_firmado` (el de la familia y su copia firmada)… (`migrate-documents-transversal`) |
| `client_visible` | BOOLEAN NOT NULL DEFAULT FALSE | ¿lo ve el paciente en su portal? (27/07/2026, `migrate-documents-client-portal`). Apagado por defecto: nada de lo ya subido se expone por accidente |
| `uploaded_by_client` | BOOLEAN NOT NULL DEFAULT FALSE | lo subió el paciente desde su portal; va sin `owner_user_id` y él lo ve siempre (misma migración) |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

Índices: `documents_owner_vis_idx` `(owner_user_id, visibility)`, `documents_folder_idx` `(folder_id)`.

### 3.3 ENUMs / relaciones

- `enum_document_folders_visibility`, `enum_documents_visibility` (`private`,`shared`).
- `documents.mime_type` = VARCHAR(150) sin CHECK (ver arriba).
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

Nueve `route.js` bajo `app/api/documents/**`, todos con `withTenant` +
`x-user-id` obligatorio + `AuditLog` en mutaciones. **La puerta no es la misma
para todos** (01/08/2026): los dos del contrato del centro piden
`hasModule("documents")` (el básico); los otros siete —el archivo— exigen
`hasModule("documents_avanzado")` y a un cliente con solo el básico le
responden 403.

| Método | Ruta | Notas |
|---|---|---|
| GET / POST | `/api/documents/contrato-servicios` | **Básico.** El Contrato de Prestación de Servicios del centro: el vigente (o `null`) / subirlo o reemplazarlo (solo admin). Es una fila de `documents` con `source='contract_template'` (`lib/documents/contratoServicios.js`), la MISMA que ve `/api/pacientes/contract-template` |
| GET | `/api/documents/contrato-servicios/download` | **Básico.** Descarga del contrato del centro |
| GET | `/api/documents/folders?visibility=&parentFolderId=` | **Avanzado.** lista por nivel (visibility private/shared/all; sin parent = raíz). Devuelve `documentCount`, `subfolderCount`, `ownerName` |
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
| GET | `/api/documents/quota` | `{usedBytes, limitBytes, usedPercent, usedMB, limitMB}` (avanzado, como todo lo anterior desde `folders`) |

### POST /api/documents — validaciones (en orden)

1. `Content-Length` > 25 MB (+overhead) → **413** (antes de parsear; el runtime rechaza
   cuerpos grandes en `formData()` con un throw genérico → así devolvemos 413 y no un 400).
2. Se acepta **cualquier** MIME declarado (desde el 23/07/2026; sin `Content-Type`
   se guarda como `application/octet-stream`). **Histórico:** MIME ∉ {pdf, docx, xlsx} → 400.
3. `buffer.length` > 25 MB → **413** (defensa; medida real).
4. Magic bytes no coinciden con el MIME → **400** (`%PDF-` / ZIP `PK\x03\x04`) — solo
   para los tipos que se saben verificar (`isAllowedMime`: PDF/DOCX/XLSX); el resto
   se acepta: es un archivo, no un ejecutable, y se sirve siempre como adjunto.
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
- Migración: `scripts/migrate-documents-sprint-1.js`. Enable: `scripts/_hechos/enable-documents-all-tenants.js`. npm: `db:enable:documents`, `db:migrate:documents` (+ `:prod`, que no vale en el VPS — ver §2; hoy todo eso lo hace `enable-module.js`).
- Smoke: `scripts/smoke-test-documents.mjs` (`npm run smoke:documents`, 21 checks) — **21/21 OK** en local.

Verificado en local (demo): enable + migración (idempotentes) + smoke completo
(carpetas anidadas, ACL private/shared entre 2 usuarios, subida válida, rechazo de
PPTX/magic-bytes/tamaño/cuota, download stream, preview inline, borrado físico de doc y
cascada de carpeta, AuditLog).

---

## 9. Sprint 2 (implementado) — UI

- `app/(dashboard)/documentos/page.jsx` → `modules/documents/DocumentsModule.jsx`.
  La página es un server component: mira en master si el tenant tiene
  `documents_avanzado` y se lo pasa al módulo como prop **`avanzado`**
  (01/08/2026). Con `avanzado=false` —el básico— el módulo no pide carpetas,
  documentos ni cuota (responderían 403) y solo pinta la tarjeta del contrato.
- `components/documents/`: `ContratoServiciosCard.jsx` (la tarjeta del Contrato
  de Prestación de Servicios, arriba del todo; lo único que ve el básico),
  `FileTypeIcon.jsx` (badge por MIME), `UploadDropzone.jsx`
  (drag & drop + click, subida 1 a 1), `PdfPreviewModal.jsx` (iframe a `/preview`,
  `top-14 lg:top-0` regla #13).
- `DocumentsModule` (con `avanzado`): tabs **Privados/Compartidos**, **breadcrumb** de navegación,
  grid de carpetas + lista de archivos, crear/renombrar/borrar carpeta (solo owner),
  subir/descargar/preview/borrar documento (borrar solo owner), **barra de cuota**.
- Verificado en local (demo): render, navegación anidada, subida PDF/DOCX, preview PDF,
  **download/preview de nombre con `€` → 200** (fix del review), tabs, crear carpeta,
  responsive móvil sin overflow. Limpieza sin huérfanos (cuota a 0).

---

## 10. Backlog

- 🔴 nginx: `client_max_body_size 30M` — **ya aplicado** en producción. Sin acción.
- ~~🟠 Rollout multi-tenant: dar `"documents"` en `user.moduleAccess`~~ — resuelto el
  01/08/2026: `enable-module.js` abre las dos puertas (admins solos, usuarios con
  `--grant-users`) y `npm run db:check-access` avisa de quien no lo ve.
- 🟠 Attachments legacy (`clients`) sin magic bytes → aplicar `validateMimeMagicBytes`.
- 🟠 Attachments legacy sin ACL por usuario ni AuditLog → aplicar el patrón de Documents.
- 🟠 Attachments legacy bufferizan 2× en el download → migrar a streaming (`readDocumentStream`).
- 🟡 Sidebar gating usa solo tenant-level; la API cruza tenant+user. Documents queda coherente
  con la API; revisar los demás módulos.
- 🟡 `moduleKey` es STRING libre en `tenant_modules`. Documents introduce `MODULE_KEYS`;
  extraer las demás keys del Sidebar y centralizarlas (y usarlas en Sidebar + enable/migrate existentes).
- 🟡 `getTenantStorageUsage` recorre el disco en cada subida — cachear/contar por tenant si crece.
- 🟡 Carrera de cuota: dos subidas concurrentes pueden pasar el check a la vez (aceptable Sprint 1).
- 🟡 Cuota configurable por tenant (algunos querrán > 1 GB). **No existe**: hoy son
  las constantes `MAX_FILE_SIZE_BYTES` / `TENANT_QUOTA_BYTES` de `documentStorage.js`,
  y ningún código de documents lee `featureFlags` ni `logicOverrides`. Si se hace,
  sería un `logicOverride` (peldaño 4 de la regla #16), leído en un solo sitio.
- 🟡 Backup `uploads/` a `/backups/` con rotación semanal (no Sprint 1).
- 🟡 GC de directorios/archivos huérfanos en `uploads/` (cronjob) — heredado de clients (no Sprint 1).
- 🟡 `UPLOADS_ROOT` (código) vs `UPLOADS_HOST_DIR` (compose): documentado en `.env.production.example`.
- 🟡 Preview DOCX/XLSX server-side (conversión LibreOffice headless) — no Sprint 1.

### 10.1 El PDF firmado: siete cosas fijadas «tal como están» (21/08/2026)

`_smoke-pdf-contrato.mjs` deja siete `it` marcados `// SOSPECHOSO`. **Ninguno
muerde hoy** —todos dependen de un camino que los llamadores actuales no
recorren—, pero la prueba dice dónde mirar el día que muerdan, y si alguien los
cambia a propósito el rojo le explica qué pasaba antes:

- la fecha del recuadro de firma («En Barcelona, a …») depende de la zona de la
  máquina, mientras la constancia va clavada a Europe/Madrid: en un documento
  firmado, dos fechas del mismo acto podrían no coincidir. Hoy no se nota porque
  producción corre en `Europe/Madrid` desde el 19/08/2026;
- una aceptación sin `acceptedAt` imprime «Aceptado el » y se queda a medias (la
  rama buena está muerta: `validarAceptaciones` siempre pone la hora);
- sin título, la cabecera lo llama «Contrato firmado» y la constancia usa la
  CLAVE de la plantilla: dos nombres para el mismo documento;
- una `version` 0 desaparece del nombre del documento (`version ? …` trata el 0
  como «no hay versión»);
- un `signerData` que llegue como LISTA cuela `length` como si fuera un dato
  declarado;
- un `secondSignatureLabel` que no sea texto **tumba** la generación
  (`toUpperCase()` a pelo, sin pasar por el `texto()` que protege al título);
- `contratoPdfFilename` lanza `RangeError` con una fecha ilegible (`toISOString()`
  sin comprobar), aunque su único llamador lo envuelve en un `.catch(() => null)`.

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
