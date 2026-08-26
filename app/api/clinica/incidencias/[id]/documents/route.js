import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  quotaBytesDe,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../../lib/documents/documentStorage.js";

/**
 * Documentos de una INCIDENCIA (archivo central, source='incidencia').
 *
 * Van al archivo central como visibility='shared' (los ve el equipo). Si la
 * incidencia tiene paciente, el documento hereda su patientId/clientId y por
 * eso aparece también en la ficha del paciente; sin paciente, queda como
 * documento interno del archivo. Mismo patrón que /api/pacientes/[id]/documents.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES_PER_INCIDENCIA = 20;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

function serialize(doc) {
  return {
    id: doc.id,
    name: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    patientId: doc.patientId ?? null,
    createdAt: doc.createdAt,
  };
}

export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const { Incidencia, Document } = ctx.tenantModels;

    const incidencia = await Incidencia.findByPk(id, { attributes: ["id"] });
    if (!incidencia) return notFound("Incidencia no encontrada");

    const rows = await Document.findAll({
      where: { incidenciaId: id },
      order: [["createdAt", "DESC"]],
      limit: MAX_FILES_PER_INCIDENCIA,
    });
    return ok({ documents: rows.map((d) => serialize(d.toJSON())), total: rows.length, limit: MAX_FILES_PER_INCIDENCIA });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);
    const { Incidencia, Document } = ctx.tenantModels;

    const incidencia = await Incidencia.findByPk(id, { attributes: ["id", "patientId", "clientId"] });
    if (!incidencia) return notFound("Incidencia no encontrada");

    const count = await Document.count({ where: { incidenciaId: id } });
    if (count >= MAX_FILES_PER_INCIDENCIA) {
      return error(`Límite alcanzado: máximo ${MAX_FILES_PER_INCIDENCIA} documentos por incidencia`, 422);
    }

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);

    // NOMBRE obligatorio (el modal de la UI lo pide, igual que en pacientes).
    const nameRaw = form.get("name");
    const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
    if (!name) return error("El nombre del documento es obligatorio", 422);

    const declaredMime = file.type || "application/octet-stream";
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length;
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + realSize > quotaBytesDe(ctx)) return error("Cuota de almacenamiento superada", 507);

    const ext = extFromFileName(file.name);
    const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(name);
    const fileName = sanitizeFileName(yaTieneExt || !ext ? name : `${name}.${ext}`);

    const documentId = randomUUID();
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, ext);

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared",
        ownerUserId,
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: declaredMime,
        // Con paciente, el documento hereda su ficha (y la del pagador); sin
        // paciente se queda como documento interno del archivo central.
        clientId: incidencia.clientId ?? null,
        patientId: incidencia.patientId ?? null,
        incidenciaId: id,
        source: "incidencia",
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    return created(serialize(row.toJSON()));
  } catch (err) {
    return serverError(err);
  }
});
