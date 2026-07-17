/**
 * contractStorage — guarda/lee/borra el CONTRATO (PDF) firmado de un paciente.
 *
 * (Motivo del fichero nuevo en /lib, regla #2: el módulo Pacientes necesita
 * persistir un PDF por paciente en el mismo volumen de uploads que los adjuntos
 * de cliente, pero bajo un layout propio `patients/{patientId}`. Reutiliza las
 * primitivas de `attachmentStorage` — getUploadsRoot, límites, generación de
 * nombre — para NO duplicar política de tamaño/mime ni tocar el storage de
 * clientes, que tiene su propio layout `clients/{clientId}`.)
 *
 * Layout en disco:
 *   {UPLOADS_ROOT}/{tenantSlug}/patients/{patientId}/{storedFilename}
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getUploadsRoot,
  generateStoredFilename,
  ALLOWED_MIME,
  MAX_FILE_SIZE_BYTES,
} from "../clients/attachmentStorage.js";

const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { generateStoredFilename, ALLOWED_MIME, MAX_FILE_SIZE_BYTES };

/** Directorio del paciente. Valida segmentos (anti path-traversal). */
export function getPatientDir(tenantSlug, patientId) {
  if (!SLUG_RE.test(tenantSlug)) throw new Error(`Invalid tenant slug: ${tenantSlug}`);
  if (!UUID_RE.test(patientId)) throw new Error(`Invalid patient id: ${patientId}`);
  return path.join(getUploadsRoot(), tenantSlug, "patients", patientId);
}

/** Path físico del contrato. Exige que storedFilename sea "{UUID}.pdf". */
export function getContractPath(tenantSlug, patientId, storedFilename) {
  if (typeof storedFilename !== "string" || !/^[0-9a-f-]{36}\.pdf$/i.test(storedFilename)) {
    throw new Error(`Invalid stored filename: ${storedFilename}`);
  }
  return path.join(getPatientDir(tenantSlug, patientId), storedFilename);
}

export async function writeContract(tenantSlug, patientId, storedFilename, buffer) {
  const dir = getPatientDir(tenantSlug, patientId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, storedFilename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readContract(tenantSlug, patientId, storedFilename) {
  return fs.readFile(getContractPath(tenantSlug, patientId, storedFilename));
}

/** Borrado best-effort e idempotente (ENOENT no falla). */
export async function deleteContractFile(tenantSlug, patientId, storedFilename) {
  try {
    await fs.unlink(getContractPath(tenantSlug, patientId, storedFilename));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    process.stderr.write(`[pacientes:contract] delete failed: ${err.message}\n`);
    return false;
  }
}
