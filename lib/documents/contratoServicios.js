/**
 * contratoServicios — el Contrato de Prestación de Servicios del centro
 * (01/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: la subida vivía metida en el endpoint
 * `/api/pacientes/contract-template`, atada al módulo clínico. Un centro que
 * solo tiene clientes —nutri_laura— no podía subir el suyo, y sin él el portal
 * no le pide la firma a NADIE. Sacar la lógica aquí permite que la pida quien
 * la necesite sin duplicarla.)
 *
 * Es UNO por cliente y reutilizable con todas las familias: se sube una vez y
 * es el documento que firman en su área privada. Se guarda como fila de
 * `documents` con `source='contract_template'`, el mismo sitio de siempre, para
 * no partir en dos lo que ya funciona en Aumenta.
 */

import { randomUUID } from "node:crypto";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "./documentStorage.js";

export const SOURCE_CONTRATO = "contract_template";

/** Vista pública (sin storagePath ni owner). */
export function serializarContrato(doc) {
  if (!doc) return null;
  const j = doc.toJSON ? doc.toJSON() : doc;
  return { id: j.id, name: j.fileName, mimeType: j.mimeType, fileSize: Number(j.fileSize), createdAt: j.createdAt };
}

/** El contrato vigente del centro, o null. El último gana. */
export async function buscarContrato(Document) {
  if (!Document) return null;
  return Document.findOne({ where: { source: SOURCE_CONTRATO }, order: [["createdAt", "DESC"]] });
}

/**
 * Sube (o reemplaza) el contrato del centro.
 *
 * Devuelve `{ error, status }` en vez de lanzar, para que cada endpoint lo
 * traduzca a su respuesta sin envolver todo en try/catch.
 */
export async function guardarContrato({ tenantModels, tenantSlug, file, nombre, ownerUserId }) {
  const { Document } = tenantModels;
  if (!Document) return { error: "Este cliente no tiene el archivo de documentos activado", status: 503 };
  if (!file || typeof file === "string") return { error: "Campo 'file' obligatorio (multipart)", status: 422 };

  const buffer = Buffer.from(await file.arrayBuffer());
  const realSize = buffer.length;
  if (!realSize) return { error: "El archivo está vacío", status: 422 };
  if (realSize > MAX_FILE_SIZE_BYTES) {
    return { error: `Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, status: 413 };
  }

  const usage = await getTenantStorageUsage(tenantSlug);
  if (usage + realSize > TENANT_QUOTA_BYTES) return { error: "Cuota de almacenamiento superada", status: 507 };

  const ext = extFromFileName(file.name);
  const limpio = (typeof nombre === "string" ? nombre.trim() : "").slice(0, 200) || "Contrato de Prestación de Servicios";
  const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(limpio);
  const fileName = sanitizeFileName(yaTieneExt || !ext ? limpio : `${limpio}.${ext}`);

  // El anterior se lee ANTES de escribir el nuevo: si esta consulta fallara
  // después, el fichero recién escrito quedaría huérfano en disco.
  const previo = await buscarContrato(Document);

  const documentId = randomUUID();
  const storagePath = await saveDocumentFile(tenantSlug, "shared", documentId, buffer, ext);

  let fila;
  try {
    fila = await Document.create({
      id: documentId,
      folderId: null,
      visibility: "shared",
      ownerUserId: ownerUserId || null,
      fileName,
      storagePath,
      fileSize: realSize,
      mimeType: file.type || "application/octet-stream",
      clientId: null,
      patientId: null,
      source: SOURCE_CONTRATO,
    });
  } catch (dbErr) {
    await deleteDocumentFile(tenantSlug, storagePath);
    throw dbErr;
  }

  // El anterior se borra solo tras persistir el nuevo (y es best-effort).
  if (previo) {
    const pathPrevio = previo.storagePath;
    await previo.destroy().catch(() => {});
    await deleteDocumentFile(tenantSlug, pathPrevio).catch(() => {});
  }

  return { doc: fila, reemplazo: !!previo };
}
