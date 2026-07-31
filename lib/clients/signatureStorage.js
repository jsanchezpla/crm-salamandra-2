/**
 * signatureStorage — guarda la IMAGEN de la firma dibujada en el portal
 * (sprint Aumenta 2026-07, punto 2.1).
 *
 * (Fichero nuevo en /lib, regla #2: no vale ninguno de los tres almacenes que
 * ya hay. `documentStorage` es el archivo del CRM —la firma no es un documento
 * que nadie deba encontrar buscando—, `attachmentStorage` es PDF-only por
 * ficha de cliente y `contractStorage` cuelga del paciente, que es justo de
 * donde el contrato se acaba de mover.)
 *
 * Layout en disco:
 *   {UPLOADS_ROOT}/{tenantSlug}/signatures/{clientId}/{uuid}.png
 *
 * La firma es un PNG pequeño dibujado con el dedo: se acota a 1 MB. Lo que da
 * valor legal no es la imagen sino el conjunto que guarda `ContractSignature`
 * (quién, cuándo, desde qué IP y con qué navegador).
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getUploadsRoot } from "../documents/documentStorage.js";

const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/;

export const MAX_SIGNATURE_BYTES = 1024 * 1024;

/** Directorio de firmas de un cliente. Valida segmentos (anti path-traversal). */
export function getSignatureDir(tenantSlug, clientId) {
  if (!SLUG_RE.test(tenantSlug)) throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  if (!UUID_RE.test(clientId)) throw new Error(`Invalid client id: ${clientId}`);
  return path.join(getUploadsRoot(), tenantSlug, "signatures", clientId);
}

/**
 * Convierte el dataURL que manda el canvas en un Buffer PNG validado.
 * Devuelve null si no es un PNG de verdad (magic bytes) o si se pasa de tamaño.
 */
export function bufferFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = PNG_DATA_URL_RE.exec(dataUrl.trim());
  if (!m) return null;
  let buffer;
  try {
    buffer = Buffer.from(m[1].replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) return null;
  // Cabecera PNG: 89 50 4E 47 0D 0A 1A 0A. Que el dataURL diga "image/png" no
  // lo convierte en PNG.
  const ok =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  return ok ? buffer : null;
}

/** Guarda el PNG y devuelve el path RELATIVO a UPLOADS_ROOT (para BD). */
export async function writeSignature(tenantSlug, clientId, buffer) {
  const dir = getSignatureDir(tenantSlug, clientId);
  await fs.mkdir(dir, { recursive: true });
  const nombre = `${randomUUID()}.png`;
  await fs.writeFile(path.join(dir, nombre), buffer);
  return `${tenantSlug}/signatures/${clientId}/${nombre}`;
}

/** Lee una firma guardada a partir del path relativo de BD. */
export async function readSignature(tenantSlug, storagePath) {
  if (typeof storagePath !== "string") throw new Error("Invalid signature path");
  const segs = storagePath.split("/");
  if (segs.length !== 4 || segs[0] !== tenantSlug || segs[1] !== "signatures") {
    throw new Error("Invalid signature path");
  }
  const abs = path.join(getSignatureDir(tenantSlug, segs[2]), segs[3]);
  return fs.readFile(abs);
}
