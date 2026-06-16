/**
 * attachmentStorage — helpers para guardar/leer/borrar archivos de cliente.
 *
 * Layout en disco:
 *   {UPLOADS_ROOT}/{tenantSlug}/clients/{clientId}/{storedFilename}
 *
 * Donde UPLOADS_ROOT es:
 *   - process.env.UPLOADS_ROOT si está seteado (override en tests).
 *   - "/app/uploads" si NODE_ENV === "production" (volumen Docker).
 *   - "<cwd>/uploads" en desarrollo (relativo al proyecto).
 *
 * storedFilename es un UUIDv4 + ".pdf" generado al subir; no contiene
 * metadatos del nombre original (que se conserva en BD para mostrar al
 * usuario y para el Content-Disposition al descargar).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES_PER_CLIENT = 50;
export const ALLOWED_MIME = "application/pdf";

export function getUploadsRoot() {
  if (process.env.UPLOADS_ROOT) return process.env.UPLOADS_ROOT;
  if (process.env.NODE_ENV === "production") return "/app/uploads";
  return path.join(process.cwd(), "uploads");
}

/**
 * Path absoluto al directorio de un cliente concreto.
 * Valida los segmentos para evitar path traversal.
 */
export function getClientDir(tenantSlug, clientId) {
  if (!SLUG_RE.test(tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  }
  if (!UUID_RE.test(clientId)) {
    throw new Error(`Invalid client id: ${clientId}`);
  }
  return path.join(getUploadsRoot(), tenantSlug, "clients", clientId);
}

/**
 * Path absoluto al fichero físico. Valida que `storedFilename` sea
 * exactamente "{UUID}.pdf" (renombrado por nosotros al subir) para
 * blindar contra path traversal vía registro corrupto en BD.
 */
export function getAttachmentPath(tenantSlug, clientId, storedFilename) {
  if (typeof storedFilename !== "string") {
    throw new Error("storedFilename must be a string");
  }
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(storedFilename)) {
    throw new Error(`Invalid stored filename: ${storedFilename}`);
  }
  return path.join(getClientDir(tenantSlug, clientId), storedFilename);
}

/** Genera un storedFilename nuevo, único, ".pdf". */
export function generateStoredFilename() {
  return `${crypto.randomUUID()}.pdf`;
}

/**
 * Escribe el archivo a disco (creando directorios si no existen).
 * Devuelve el path absoluto escrito.
 */
export async function writeAttachment(tenantSlug, clientId, storedFilename, buffer) {
  const dir = getClientDir(tenantSlug, clientId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, storedFilename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Best-effort delete. Si el archivo no existe, no falla (idempotente).
 * Loguea cualquier error inesperado pero no lo propaga.
 */
export async function deleteAttachmentFile(tenantSlug, clientId, storedFilename) {
  try {
    const filePath = getAttachmentPath(tenantSlug, clientId, storedFilename);
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    process.stderr.write(`[clients:attachment] delete failed: ${err.message}\n`);
    return false;
  }
}

/** Devuelve un Buffer con el contenido del archivo. Propaga errores. */
export async function readAttachment(tenantSlug, clientId, storedFilename) {
  const filePath = getAttachmentPath(tenantSlug, clientId, storedFilename);
  return fs.readFile(filePath);
}
