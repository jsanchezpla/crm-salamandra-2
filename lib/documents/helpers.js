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

/*
 * ── Y LO QUE LE HAN COMPARTIDO A UNO (01/09/2026) ───────────────────────────
 *
 * Desde que una carpeta puede compartirse con personas sueltas
 * (`lib/documents/carpetasCompartidas.js`), «lo que veo» ya no sale solo de
 * `visibility`: hay un tercer camino, «estoy en la lista de esa carpeta».
 *
 * Va en DOS funciones y no en un parámetro de `visibilityWhere` porque la
 * columna a comparar no es la misma: en una carpeta es su propio `id`; en un
 * documento, el `folderId` de la carpeta donde vive. Un solo helper con un
 * flag acabaría en el `where` equivocado el día que alguien lo copie.
 *
 * Las compartidas entran por el lado de `shared`, no por el de `private`: la
 * pestaña «Compartido» del archivo significa «lo que no es solo mío», y ahí es
 * donde una persona espera encontrar lo que le han pasado. En «Mis documentos»
 * sigue habiendo solo lo suyo.
 */

function orDeVisibilidad(userId, visibility, extra) {
  if (visibility === "private") return { visibility: "private", ownerUserId: userId };
  const ramas = [{ visibility: "shared" }];
  if (extra) ramas.push(extra);
  if (visibility !== "shared") ramas.push({ visibility: "private", ownerUserId: userId });
  return { [Op.or]: ramas };
}

/** Where para CARPETAS: las de siempre, más las compartidas conmigo. */
export function whereCarpetasVisibles(userId, visibility, idsCompartidas = []) {
  const ids = idsCompartidas?.length ? idsCompartidas : null;
  return orDeVisibilidad(userId, visibility, ids ? { id: { [Op.in]: ids } } : null);
}

/** Where para DOCUMENTOS: los de siempre, más los que viven en una compartida. */
export function whereDocumentosVisibles(userId, visibility, idsCompartidas = []) {
  const ids = idsCompartidas?.length ? idsCompartidas : null;
  return orDeVisibilidad(userId, visibility, ids ? { folderId: { [Op.in]: ids } } : null);
}

// ¿Puede el user VER esta fila? (mismo criterio que visibilityWhere)
export function canView(row, userId) {
  if (!row) return false;
  if (row.visibility === "shared") return true;
  return row.visibility === "private" && row.ownerUserId === userId;
}

/** Lo de siempre, o que la carpeta esté compartida conmigo. */
export function canViewFolder(folder, userId, idsCompartidas = []) {
  if (canView(folder, userId)) return true;
  return !!folder && (idsCompartidas ?? []).includes(folder.id);
}

/** Lo de siempre, o que el documento viva en una carpeta compartida conmigo. */
export function canViewDocument(doc, userId, idsCompartidas = []) {
  if (canView(doc, userId)) return true;
  return !!doc?.folderId && (idsCompartidas ?? []).includes(doc.folderId);
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
    // Con cuánta gente está compartida a mano (01/09/2026). 0 = como siempre.
    // `compartidaConmigo` distingue «es mía» de «me la han pasado», que es lo
    // que decide si la pantalla enseña el botón de compartir.
    sharedWith: extra.sharedWith ?? 0,
    compartidaConmigo: extra.compartidaConmigo ?? false,
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
    // Archivo central (2026-07-23): para quién es y de dónde vino.
    clientId: d.clientId ?? null,
    patientId: d.patientId ?? null,
    // El tramo de agenda al que está aparejado (01/09/2026), si lo está: el
    // archivo lo enseña para que se sepa de dónde cuelga sin abrir la agenda.
    teamBlockId: d.teamBlockId ?? null,
    // La sesión de cuya preparación salió (02/09/2026, AV-0027), si es el caso.
    clinicSessionId: d.clinicSessionId ?? null,
    source: d.source ?? "manual",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
