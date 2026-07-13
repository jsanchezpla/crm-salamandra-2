/**
 * Helpers compartidos de los endpoints de Documents: auditoría, resolución de
 * nombres de autor, filtros de visibilidad (ACL) y serializers.
 */
import { Op } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";

// AuditLog en master. Nunca rompe la request (best-effort, try/catch silencioso).
export async function logDocumentsAudit(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría no debe tumbar la operación.
  }
}

// Batch-resuelve el "nombre" del autor (email) desde master.users. Sprint 1:
// usamos el email como ownerName; si el user no existe, queda null.
export async function resolveOwnerNames(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const { User } = getMasterModels();
    const rows = await User.findAll({ where: { id: ids }, attributes: ["id", "email"] });
    return new Map(rows.map((r) => [r.id, r.email]));
  } catch {
    return new Map();
  }
}

/**
 * Where de visibilidad para folders/documents según el filtro pedido:
 *   private → solo del user · shared → todas del tenant · all → ambas.
 */
export function visibilityWhere(userId, visibility) {
  if (visibility === "shared") return { visibility: "shared" };
  if (visibility === "private") return { visibility: "private", ownerUserId: userId };
  return { [Op.or]: [{ visibility: "shared" }, { visibility: "private", ownerUserId: userId }] };
}

// ¿Puede el user VER esta fila? (mismo criterio que visibilityWhere)
export function canView(row, userId) {
  if (!row) return false;
  if (row.visibility === "shared") return true;
  return row.visibility === "private" && row.ownerUserId === userId;
}

// ¿Puede el user CREAR dentro de esta carpeta padre?
//   private → solo el owner · shared → cualquier user del tenant.
export function canCreateInside(parent, userId) {
  if (!parent) return true; // raíz
  if (parent.visibility === "shared") return true;
  return parent.ownerUserId === userId;
}

// Segmento de disco según visibilidad: private → userId, shared → "shared".
export function ownerSegmentFor(visibility, userId) {
  return visibility === "shared" ? "shared" : userId;
}

export function serializeFolder(f, ownerName, extra = {}) {
  return {
    id: f.id,
    name: f.name,
    level: f.level,
    visibility: f.visibility,
    parentFolderId: f.parentFolderId ?? null,
    ownerUserId: f.ownerUserId,
    ownerName: ownerName ?? null,
    documentCount: extra.documentCount ?? 0,
    subfolderCount: extra.subfolderCount ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

/**
 * Content-Disposition seguro. `filename="..."` solo admite Latin-1/ASCII (el
 * constructor de Response valida ByteString y LANZA con code points > 255, p.ej.
 * €, guiones tipográficos, emoji), así que el fallback va restringido a ASCII
 * imprimible y el nombre real fiel viaja en `filename*=UTF-8''` (RFC 5987).
 */
export function contentDisposition(type, fileName) {
  const name = String(fileName ?? "archivo");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function serializeDocument(d, ownerName) {
  return {
    id: d.id,
    fileName: d.fileName,
    fileSize: Number(d.fileSize),
    mimeType: d.mimeType,
    visibility: d.visibility,
    folderId: d.folderId ?? null,
    ownerUserId: d.ownerUserId,
    ownerName: ownerName ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
