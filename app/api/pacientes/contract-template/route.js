import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../lib/documents/documentStorage.js";

/**
 * Contrato ESTÁNDAR de la clínica (source='contract_template'). Uno por tenant,
 * reutilizable en TODOS los pacientes: se sube una vez y aparece en cada ficha.
 *
 * GET  → el contrato actual (o null).       Gated a Clínica/Pacientes.
 * POST → sube/reemplaza (solo admin).        Al subir uno nuevo, borra el anterior.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const SOURCE = "contract_template";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

function serialize(doc) {
  if (!doc) return null;
  const j = doc.toJSON ? doc.toJSON() : doc;
  return { id: j.id, name: j.fileName, mimeType: j.mimeType, fileSize: Number(j.fileSize), createdAt: j.createdAt };
}

async function currentTemplate(Document) {
  return Document.findOne({ where: { source: SOURCE }, order: [["createdAt", "DESC"]] });
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { Document } = ctx.tenantModels;
    return ok({ template: serialize(await currentTemplate(Document)) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede fijar el contrato estándar");
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);
    const { Document } = ctx.tenantModels;

    let form;
    try { form = await request.formData(); } catch { return error("Body inválido: se esperaba multipart/form-data", 400); }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);
    const nameRaw = form.get("name");
    const name = (typeof nameRaw === "string" ? nameRaw.trim() : "").slice(0, 200) || "Contrato estándar";

    const declaredMime = file.type || "application/octet-stream";
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

    // Borrar el anterior (uno por tenant). Best-effort: si falla, no aborta.
    const prev = await currentTemplate(Document);

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
        clientId: null,
        patientId: null,
        source: SOURCE,
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    if (prev) {
      const prevPath = prev.storagePath;
      await prev.destroy().catch(() => {});
      await deleteDocumentFile(ctx.tenant.slug, prevPath).catch(() => {});
    }

    return created(serialize(row));
  } catch (err) {
    return serverError(err);
  }
});
