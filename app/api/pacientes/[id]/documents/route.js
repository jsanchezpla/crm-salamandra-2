import { Op } from "sequelize";
import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../lib/documents/documentStorage.js";

/**
 * Documentos de un PACIENTE (archivo central, source='paciente').
 *
 * Gated a Clínica/Pacientes (NO al módulo documents: aumenta/demo tienen la
 * tabla documents pero no el módulo). El buscador escribe el nombre y filtra;
 * al subir, el nombre es OBLIGATORIO (lo pide un modal en la UI).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES_PER_PATIENT = 100;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

function serialize(doc) {
  return {
    id: doc.id,
    name: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    createdAt: doc.createdAt,
  };
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const { Patient, Document } = ctx.tenantModels;

    const patient = await Patient.findByPk(id, { attributes: ["id"] });
    if (!patient) return notFound("Paciente no encontrado");

    const where = { patientId: id, source: "paciente" };
    const q = (new URL(request.url).searchParams.get("q") || "").trim();
    if (q) where.fileName = { [Op.iLike]: `%${q}%` };

    const rows = await Document.findAll({ where, order: [["createdAt", "DESC"]], limit: MAX_FILES_PER_PATIENT });
    return ok({ documents: rows.map((d) => serialize(d.toJSON())), total: rows.length, limit: MAX_FILES_PER_PATIENT });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);
    const { Patient, Document } = ctx.tenantModels;

    const patient = await Patient.findByPk(id, { attributes: ["id", "clientId"] });
    if (!patient) return notFound("Paciente no encontrado");

    const count = await Document.count({ where: { patientId: id, source: "paciente" } });
    if (count >= MAX_FILES_PER_PATIENT) {
      return error(`Límite alcanzado: máximo ${MAX_FILES_PER_PATIENT} documentos por paciente`, 422);
    }

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);

    // NOMBRE obligatorio (el modal de la UI lo exige).
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
    if (usage + realSize > TENANT_QUOTA_BYTES) return error("Cuota de almacenamiento superada", 507);

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
        clientId: patient.clientId ?? null, // enlaza también con el pagador si lo tiene
        patientId: id,
        source: "paciente",
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
