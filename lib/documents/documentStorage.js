/**
 * documentStorage — helpers de disco para el módulo Documents.
 *
 * Clonado y GENERALIZADO de `lib/clients/attachmentStorage.js` (regla #2 de
 * CLAUDE.md: no reutilizar in-place el de clients, que está hardcodeado a
 * `.pdf` y a la ruta `clients/{clientId}`). Diferencias clave:
 *   - Acepta PDF/DOCX/XLSX (extensión derivada del MIME, no del cliente).
 *   - Layout por tenant + owner/visibility.
 *   - Lectura por STREAM (no buffer completo) para servir 25 MB sin doblar RAM.
 *   - Validación de MIME por MAGIC BYTES (no solo la extensión / Content-Type).
 *   - Uso de almacenamiento agregado por tenant (para la cuota).
 *
 * Layout en disco (storagePath = path RELATIVO a UPLOADS_ROOT, con "/"):
 *   documents/{tenantSlug}/{ownerUserId | "shared"}/{documentUUID}.{ext}
 *
 * UPLOADS_ROOT:
 *   - process.env.UPLOADS_ROOT si está seteado (override en tests).
 *   - "/app/uploads" si NODE_ENV === "production" (volumen Docker; host
 *     /opt/crm-salamandra/uploads vía UPLOADS_HOST_DIR del docker-compose).
 *   - "<cwd>/uploads" en desarrollo.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

// ── Constantes de negocio ────────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB por archivo
export const TENANT_QUOTA_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB por tenant

/**
 * Cuota efectiva del tenant (26/08/2026). El giga de serie se queda para
 * todos; quien necesita más lo lleva en `logicOverrides.quotaBytes` del módulo
 * `documents` (primer uso real de logicOverrides: el archivo migrado de
 * OneDrive de Aumenta no cabe en un giga). Acepta cualquier contexto que sepa
 * `getLogicOverride`; sin él, la constante.
 */
export function quotaBytesDe(ctx) {
  const v = Number(ctx?.getLogicOverride?.("documents", "quotaBytes"));
  return Number.isFinite(v) && v > 0 ? v : TENANT_QUOTA_BYTES;
}

// MIME permitido → extensión en disco. Fuente única de tipos aceptados.
export const MIME_EXT = Object.freeze({
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
});
export const ALLOWED_MIME_TYPES = Object.freeze(Object.keys(MIME_EXT));

export function isAllowedMime(mime) {
  return Object.prototype.hasOwnProperty.call(MIME_EXT, mime);
}

/**
 * Extensión segura para disco, derivada del nombre original. Para el archivo
 * central transversal (que acepta cualquier fichero) no se puede sacar del
 * MIME. Se limita a alfanumérico y máximo 10 chars; sin nada válido → "bin".
 */
export function extFromFileName(name) {
  const m = typeof name === "string" ? name.match(/\.([A-Za-z0-9]{1,10})$/) : null;
  return m ? m[1].toLowerCase() : "bin";
}

// ── Guards de path (anti path-traversal) ─────────────────────────────────────
const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// documents/{slug}/{shared|uuid}/{uuid}.{ext}  — ext alfanumérica (cualquier
// tipo, desde 2026-07-23: el archivo central acepta cualquier fichero).
const STORAGE_PATH_RE = /^documents\/[a-z0-9_]+\/(shared|[0-9a-f-]{36})\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i;

export function getUploadsRoot() {
  if (process.env.UPLOADS_ROOT) return process.env.UPLOADS_ROOT;
  if (process.env.NODE_ENV === "production") return "/app/uploads";
  return path.join(process.cwd(), "uploads");
}

/**
 * Sanea el nombre visible del archivo: quita control chars, separadores de
 * ruta y "..". NUNCA se usa en disco (en disco va el UUID) pero se guarda en BD.
 */
export function sanitizeFileName(name) {
  const base = typeof name === "string" && name.trim() ? name : "archivo";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "") // control chars
    .replace(/[\\/]/g, "_") // separadores de ruta
    .replace(/\.{2,}/g, ".") // colapsa ".." → "."
    .trim()
    .slice(0, 255);
  return cleaned || "archivo";
}

/**
 * Valida el MIME por MAGIC BYTES (no confía en la extensión ni en el
 * Content-Type declarado por el cliente).
 *   - PDF  → "%PDF-"                (25 50 44 46 2D)
 *   - OOXML (DOCX/XLSX) → ZIP local header (50 4B 03 04, "PK..")
 */
export function validateMimeMagicBytes(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  const b = buffer.subarray(0, 8);
  if (declaredMime === "application/pdf") {
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
  }
  if (declaredMime.startsWith("application/vnd.openxmlformats")) {
    return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  }
  return false;
}

/**
 * La extensión que le CORRESPONDE a un fichero por su contenido, mirando los
 * primeros bytes. `null` si no es ninguno de los que sabemos reconocer.
 *
 * ── POR QUÉ HACE FALTA, Y POR QUÉ NO BASTA CON EL NOMBRE (24/08/2026) ──────
 * En todo este repo la regla es que el tipo de un fichero lo decide la extensión
 * que guardamos NOSOTROS, y no el `Content-Type` que declare el navegador —que
 * es texto que escribe quien sube—. Bien. El agujero era que esa extensión
 * «nuestra» salía del NOMBRE del fichero, que también lo escribe quien sube.
 *
 * Se vio a la primera. Jorge colgó en el Registro una captura que Chrome en
 * Windows había guardado como `.jfif`: un JPEG perfectamente normal, declarado
 * `image/jpeg`, que se guardó como `.jfif` y por tanto no casaba con ninguna
 * entrada de la lista blanca de lo que se enseña en pantalla. Resultado: una
 * imagen pintada como «fichero», sin ningún error que lo explicara.
 *
 * Mirando los bytes, un JPEG es un JPEG se llame como se llame. Esto cierra la
 * clase entera: el `.jfif` de Chrome, el fichero sin extensión, el que alguien
 * renombró a `.txt`, y de paso el `.png` que en realidad no es un PNG.
 *
 * NO sustituye a la lista blanca de qué se sirve en línea: eso sigue decidiendo
 * qué se ENSEÑA. Esto solo decide cómo se GUARDA, que es el paso de antes.
 */
export function extensionPorContenido(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const b = buffer;

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  // JPEG — FF D8 FF. Cubre jpg, jpeg, jfif y jpe, que son el mismo fichero.
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  // GIF — "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  // WEBP — "RIFF" …4 bytes de tamaño… "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  // PDF — "%PDF-"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "pdf";
  }
  return null;
}

// Directorio absoluto del tenant. Valida el slug contra traversal.
function tenantDir(tenantSlug) {
  if (!SLUG_RE.test(tenantSlug)) throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  return path.join(getUploadsRoot(), "documents", tenantSlug);
}

// Resuelve un storagePath relativo (de BD) a path absoluto, blindando traversal.
function absFromStoragePath(tenantSlug, storagePath) {
  if (typeof storagePath !== "string" || !STORAGE_PATH_RE.test(storagePath)) {
    throw new Error(`Invalid storage path: ${storagePath}`);
  }
  // El segundo segmento debe ser el tenant de la request (aislamiento).
  const segs = storagePath.split("/");
  if (segs[1] !== tenantSlug) throw new Error("storagePath tenant mismatch");
  const root = getUploadsRoot();
  // Concatenación A PROPÓSITO, no path.join/resolve: el trazador NFT de
  // Turbopack trata "join de un string que también pasa por split()" como ruta
  // multi-nivel irresoluble y traza el proyecto ENTERO en `next build` (aviso
  // "Encountered unexpected file in NFT list"). storagePath ya está validado
  // por STORAGE_PATH_RE (relativo, sin "..", con "/"); los fs.* de Node
  // aceptan separadores mixtos en Windows. path.relative hace de cinturón.
  const abs = root + "/" + storagePath;
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected");
  }
  return abs;
}

/**
 * Guarda el archivo en disco y devuelve el storagePath RELATIVO (para BD).
 * `ownerSegment` = ownerUserId (UUID) para private, o la cadena "shared".
 * `documentId` = UUID nuevo del documento. Extensión derivada del MIME.
 */
export async function saveDocumentFile(tenantSlug, ownerSegment, documentId, buffer, ext) {
  if (!SLUG_RE.test(tenantSlug)) throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  if (ownerSegment !== "shared" && !UUID_RE.test(ownerSegment)) {
    throw new Error(`Invalid owner segment: ${ownerSegment}`);
  }
  if (!UUID_RE.test(documentId)) throw new Error(`Invalid document id: ${documentId}`);
  // La extensión la decide quien llama (del MIME para los tipos clásicos, del
  // nombre para el archivo central). Se sanea aquí por si acaso.
  const safeExt = /^[a-z0-9]{1,10}$/i.test(ext || "") ? ext.toLowerCase() : "bin";

  const dir = path.join(tenantDir(tenantSlug), ownerSegment);
  const filePath = path.join(dir, `${documentId}.${safeExt}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return `documents/${tenantSlug}/${ownerSegment}/${documentId}.${safeExt}`;
}

/**
 * Abre el archivo como STREAM (no buffer). Hace stat primero para devolver
 * tamaño y para fallar con ENOENT ANTES de empezar la respuesta HTTP.
 * Devuelve { stream, size }.
 */
export async function readDocumentStream(tenantSlug, storagePath) {
  const abs = absFromStoragePath(tenantSlug, storagePath);
  const st = await fs.stat(abs); // lanza ENOENT si no existe
  return { stream: createReadStream(abs), size: st.size };
}

/** Borrado best-effort. ENOENT no falla (idempotente). */
export async function deleteDocumentFile(tenantSlug, storagePath) {
  try {
    const abs = absFromStoragePath(tenantSlug, storagePath);
    await fs.unlink(abs);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    process.stderr.write(`[documents] delete failed: ${err.message}\n`);
    return false;
  }
}

/**
 * Bytes totales usados por el tenant (suma real en disco). Recorre
 * documents/{tenantSlug}/**. Si el directorio no existe todavía → 0.
 * (Sprint 1: recorrido en cada subida; ver backlog — cachear/contador.)
 */
export async function getTenantStorageUsage(tenantSlug) {
  const dir = tenantDir(tenantSlug);
  let total = 0;
  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
    }
  }
  await walk(dir);
  return total;
}
