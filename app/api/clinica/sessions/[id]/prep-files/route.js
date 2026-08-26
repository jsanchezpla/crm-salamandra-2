import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { serializeSession } from "../../../../../../lib/clinica/serialize.js";
import { extPermitida, listaPrepFiles, nuevoPrepFile, MAX_PREP_FILES } from "../../../../../../lib/clinica/prepFiles.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  quotaBytesDe,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
} from "../../../../../../lib/documents/documentStorage.js";

/**
 * POST /api/clinica/sessions/[id]/prep-files — sube un adjunto de la
 * PREPARACIÓN de la sesión (sprint Aumenta 2026-07, punto 4).
 *
 * Fotos, notas de voz o un PDF que la terapeuta trae de la sesión. Es material
 * interno: no se crea fila en `documents`, así que no aparece en el buscador
 * del CRM ni puede colarse en el área privada de la familia.
 *
 * multipart/form-data, campo "file".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicSession } = ctx.tenantModels;
    const sesion = await ClinicSession.findByPk(id);
    if (!sesion) return notFound("Sesión no encontrada");

    const actuales = listaPrepFiles(sesion);
    if (actuales.length >= MAX_PREP_FILES) {
      return error(`Máximo ${MAX_PREP_FILES} adjuntos por sesión`, 422);
    }

    // Tope por Content-Length antes de bufferizar (un audio largo puede pesar).
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }
    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);

    const ext = extPermitida(file.name, file.type);
    if (!ext) return error("Tipo de archivo no permitido: solo fotos, audio o PDF", 422);

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) return error("El archivo está vacío", 422);
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + buffer.length > quotaBytesDe(ctx)) return error("Cuota de almacenamiento superada", 507);

    const fileId = randomUUID();
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", fileId, buffer, ext);

    const entrada = nuevoPrepFile({
      name: sanitizeFileName(file.name || `adjunto.${ext}`),
      storagePath,
      mimeType: file.type,
      size: buffer.length,
      uploadedBy: request.headers.get("x-user-email") ?? null,
    });
    entrada.id = fileId; // el id del adjunto ES el del fichero en disco

    try {
      await sesion.update({ prepFiles: [...actuales, entrada] });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.session.prep_file_added",
      entity: "ClinicSession",
      entityId: id,
      after: { adjunto: entrada.name, bytes: entrada.size },
      ip: request.headers.get("x-forwarded-for"),
    });

    return created(serializeSession(sesion));
  } catch (err) {
    return serverError(err);
  }
});
