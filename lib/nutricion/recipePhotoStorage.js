/**
 * recipePhotoStorage — foto de receta en disco (rework Nutrición 2026-07-22).
 *
 * Clonado de `lib/documents/documentStorage.js` (regla #2 de CLAUDE.md: los
 * helpers de almacenamiento se clonan por dominio, no se generalizan in-place).
 * Diferencias: acepta IMÁGENES (JPEG/PNG/WebP) en vez de documentos, límite
 * 5 MB (una foto de plato no necesita más y el PDF del menú las embebe), y
 * layout por receta. Primer punto del repo que acepta image/* — no existía
 * ningún patrón de subida de imágenes (los avatares son URLs pegadas a mano).
 *
 * Layout en disco (photoPath = path RELATIVO a UPLOADS_ROOT, con "/"):
 *   nutricion-recipes/{tenantSlug}/{recipeId}/{photoUUID}.{ext}
 *
 * El UUID de fichero cambia en cada subida (se borra el anterior): sirve de
 * cache-buster natural en la URL del GET.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { getUploadsRoot } from "../documents/documentStorage.js";

// ── Constantes de negocio ────────────────────────────────────────────────────
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// MIME permitido → extensión en disco. Fuente única de tipos aceptados.
export const PHOTO_MIME_EXT = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});
export const ALLOWED_PHOTO_MIME_TYPES = Object.freeze(Object.keys(PHOTO_MIME_EXT));
// Content-Type de respuesta al servir, por extensión (inversa de PHOTO_MIME_EXT).
export const PHOTO_EXT_MIME = Object.freeze({
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

export function isAllowedPhotoMime(mime) {
  return Object.prototype.hasOwnProperty.call(PHOTO_MIME_EXT, mime);
}

// ── Guards de path (anti path-traversal) ─────────────────────────────────────
const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// nutricion-recipes/{slug}/{recipeUuid}/{photoUuid}.{jpg|png|webp}
const PHOTO_PATH_RE = /^nutricion-recipes\/[a-z0-9_]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;

/**
 * Valida el MIME por MAGIC BYTES (no confía en la extensión ni en el
 * Content-Type declarado por el cliente).
 *   - JPEG → FF D8 FF
 *   - PNG  → 89 50 4E 47 0D 0A 1A 0A
 *   - WebP → "RIFF" .... "WEBP"  (bytes 0-3 y 8-11)
 */
export function validatePhotoMagicBytes(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const b = buffer.subarray(0, 12);
  if (declaredMime === "image/jpeg") {
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (declaredMime === "image/png") {
    return (
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    );
  }
  if (declaredMime === "image/webp") {
    return (
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
    );
  }
  return false;
}

// Resuelve un photoPath relativo (de BD) a path absoluto, blindando traversal.
function absFromPhotoPath(tenantSlug, photoPath) {
  if (typeof photoPath !== "string" || !PHOTO_PATH_RE.test(photoPath)) {
    throw new Error(`Invalid photo path: ${photoPath}`);
  }
  const segs = photoPath.split("/");
  if (segs[1] !== tenantSlug) throw new Error("photoPath tenant mismatch");
  const root = getUploadsRoot();
  // Concatenación A PROPÓSITO, no path.join/resolve (mismo motivo que en
  // absFromStoragePath de documentStorage): el trazador NFT de Turbopack trata
  // "join de un string que también pasa por split()" como ruta irresoluble y
  // traza el proyecto entero en `next build`. photoPath ya está validado por
  // PHOTO_PATH_RE; path.relative hace de cinturón.
  const abs = root + "/" + photoPath;
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected");
  }
  return abs;
}

/**
 * Guarda la foto en disco y devuelve el photoPath RELATIVO (para BD).
 * `photoId` = UUID nuevo por subida (cache-buster). Extensión derivada del MIME.
 */
export async function saveRecipePhoto(tenantSlug, recipeId, photoId, buffer, mimeType) {
  if (!SLUG_RE.test(tenantSlug)) throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  if (!UUID_RE.test(recipeId)) throw new Error(`Invalid recipe id: ${recipeId}`);
  if (!UUID_RE.test(photoId)) throw new Error(`Invalid photo id: ${photoId}`);
  const ext = PHOTO_MIME_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported mime: ${mimeType}`);

  const dir = path.join(getUploadsRoot(), "nutricion-recipes", tenantSlug, recipeId);
  const filePath = path.join(dir, `${photoId}.${ext}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return `nutricion-recipes/${tenantSlug}/${recipeId}/${photoId}.${ext}`;
}

/** Content-Type que corresponde a un photoPath guardado en BD. */
export function photoContentType(photoPath) {
  const ext = String(photoPath).split(".").pop().toLowerCase();
  return PHOTO_EXT_MIME[ext] || "application/octet-stream";
}

/**
 * Abre la foto como STREAM. stat primero para fallar con ENOENT ANTES de
 * empezar la respuesta HTTP. Devuelve { stream, size }.
 */
export async function readRecipePhotoStream(tenantSlug, photoPath) {
  const abs = absFromPhotoPath(tenantSlug, photoPath);
  const st = await fs.stat(abs);
  return { stream: createReadStream(abs), size: st.size };
}

/** Lee la foto completa a Buffer (para embeberla en el PDF del menú). */
export async function readRecipePhotoBuffer(tenantSlug, photoPath) {
  const abs = absFromPhotoPath(tenantSlug, photoPath);
  return await fs.readFile(abs);
}

/** Borrado best-effort. ENOENT no falla (idempotente). */
export async function deleteRecipePhoto(tenantSlug, photoPath) {
  try {
    const abs = absFromPhotoPath(tenantSlug, photoPath);
    await fs.unlink(abs);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    process.stderr.write(`[nutricion] photo delete failed: ${err.message}\n`);
    return false;
  }
}
