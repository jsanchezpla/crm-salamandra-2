/**
 * ticketStorage — helpers de disco para los adjuntos de tickets del módulo
 * Soporte. Mismo enfoque que lib/documents/documentStorage.js (de quien
 * importa los helpers genéricos, regla #2: no se toca ese fichero), con su
 * propio layout y límites más cortos: esto son capturas y PDFs de un hilo de
 * soporte, no el archivo documental del tenant.
 *
 * Layout en disco (storagePath RELATIVO a UPLOADS_ROOT, con "/"):
 *   support/{tenantSlug}/{ticketUUID}/{attachmentUUID}.{ext}
 *
 * Se acepta cualquier tipo de fichero (como el archivo central): se sirve
 * siempre como adjunto (Content-Disposition: attachment), nunca se ejecuta.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { getUploadsRoot, sanitizeFileName, extFromFileName } from "../documents/documentStorage.js";

export const MAX_TICKET_FILE_BYTES = 10 * 1024 * 1024; // 10 MB por archivo
export const MAX_FILES_PER_MESSAGE = 5;

const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// support/{slug}/{uuid}/{uuid}.{ext}
const STORAGE_PATH_RE = /^support\/[a-z0-9_]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i;

export { sanitizeFileName, extFromFileName };

function assertSlug(slug) {
  if (!SLUG_RE.test(String(slug || ""))) throw new Error(`Slug inválido: ${slug}`);
}

function absPath(storagePath) {
  if (!STORAGE_PATH_RE.test(String(storagePath || ""))) {
    throw new Error("storagePath de adjunto inválido");
  }
  return path.join(getUploadsRoot(), ...storagePath.split("/"));
}

/** Escribe el binario y devuelve el storagePath relativo (para BD). */
export async function saveTicketFile(slug, ticketId, attachmentId, buffer, ext) {
  assertSlug(slug);
  if (!UUID_RE.test(ticketId) || !UUID_RE.test(attachmentId)) {
    throw new Error("ids inválidos para adjunto");
  }
  const safeExt = /^[a-z0-9]{1,10}$/i.test(ext || "") ? ext.toLowerCase() : "bin";
  const rel = `support/${slug}/${ticketId}/${attachmentId}.${safeExt}`;
  const abs = absPath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return rel;
}

/** Stream de lectura + tamaño real, para servir la descarga sin doblar RAM. */
export async function openTicketFileStream(storagePath) {
  const abs = absPath(storagePath);
  const stat = await fs.stat(abs);
  return { stream: createReadStream(abs), size: stat.size };
}

/** Borra un adjunto del disco. Best-effort: si no está, no pasa nada. */
export async function deleteTicketFile(storagePath) {
  try {
    await fs.unlink(absPath(storagePath));
  } catch {
    /* ya no estaba */
  }
}

/** Borra la carpeta entera de un ticket (al eliminar el ticket). */
export async function deleteTicketFolder(slug, ticketId) {
  assertSlug(slug);
  if (!UUID_RE.test(ticketId)) return;
  const abs = path.join(getUploadsRoot(), "support", slug, ticketId);
  try {
    await fs.rm(abs, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
