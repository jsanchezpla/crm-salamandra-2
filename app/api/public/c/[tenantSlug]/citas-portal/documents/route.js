import { Op } from "sequelize";
import { randomUUID } from "node:crypto";
import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, created, error, unauthorized, forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import { normalizeEmail } from "../../../../../../../lib/citas/validation.js";
import { resolvePortalClient } from "../../../../../../../lib/citas/portalClient.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  extFromFileName,
} from "../../../../../../../lib/documents/documentStorage.js";

/**
 * Documentos del PACIENTE en su portal ("Mis documentos").
 *
 * Qué ve: SOLO los documentos de SU ficha que cumplan una de dos:
 *   - los que el equipo marcó como visibles (`client_visible`), o
 *   - los que subió él mismo (`uploaded_by_client`).
 * Nunca ve el resto del archivo del CRM ni documentos de otra persona: la
 * consulta va siempre acotada por el `clientId` resuelto desde SU sesión.
 *
 * Qué sube: archivos para su profesional. Aparecen en Adjuntos de la ficha
 * marcados como subidos por ella.
 *
 *   GET  → { documents: [...], canUpload, limit }
 *   POST → multipart 'file' → 201
 */

// Tope propio del portal: mucho menor que el del CRM. Es un canal público
// (cualquiera con sesión de paciente), así que no se le deja llenar el disco.
const MAX_FILES_PER_CLIENT_PORTAL = 20;

function gate(tenant, hasModule) {
  if (!hasModule("citas")) return notFound("Módulo no disponible");
  if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal no habilitado");
  return null;
}

// Solo lo que este paciente puede ver: compartido con él o subido por él.
function wherePaciente(clientId) {
  return {
    clientId,
    source: "ficha",
    [Op.or]: [{ clientVisible: true }, { uploadedByClient: true }],
  };
}

function serialize(doc) {
  return {
    id: doc.id,
    name: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: Number(doc.fileSize),
    createdAt: doc.createdAt,
    // Para que el portal distinga "esto me lo dejó Laura" de "esto lo subí yo".
    mine: !!doc.uploadedByClient,
  };
}

// Resuelve la sesión y la ficha. Devuelve { client } o { response } con el error.
async function resolveSession(request, slug, tenantModels) {
  let email;
  try {
    ({ email } = await verifyPortalSession(readBearer(request), slug));
  } catch {
    return { response: unauthorized("Sesión no válida o caducada") };
  }
  const normalized = normalizeEmail(email);
  if (!normalized) return { response: unauthorized("Sesión no válida o caducada") };

  const client = await resolvePortalClient(tenantModels, normalized);
  // Sin ficha aún (p. ej. reservó pero Laura no la ha creado): no es un error,
  // simplemente no hay documentos.
  return { client, email: normalized };
}

export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gate(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client } = await resolveSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return ok({ documents: [], canUpload: false, limit: MAX_FILES_PER_CLIENT_PORTAL });

    const { Document } = tenantModels;
    const rows = await Document.findAll({
      where: wherePaciente(client.id),
      order: [["createdAt", "DESC"]],
      limit: 200,
    });

    const mineCount = await Document.count({
      where: { clientId: client.id, source: "ficha", uploadedByClient: true },
    });

    return ok({
      documents: rows.map(serialize),
      canUpload: mineCount < MAX_FILES_PER_CLIENT_PORTAL,
      limit: MAX_FILES_PER_CLIENT_PORTAL,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gate(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client } = await resolveSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) {
      return error("Todavía no podemos asociar tus documentos. Escríbenos y lo revisamos.", 409);
    }

    const { Document } = tenantModels;

    // Tope de subidas PROPIAS (las que comparte el equipo no cuentan).
    const mineCount = await Document.count({
      where: { clientId: client.id, source: "ficha", uploadedByClient: true },
    });
    if (mineCount >= MAX_FILES_PER_CLIENT_PORTAL) {
      return error(`Has alcanzado el máximo de ${MAX_FILES_PER_CLIENT_PORTAL} documentos.`, 422);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") return error("Falta el archivo", 422);

    const declaredMime = file.type || "application/octet-stream";
    if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
      return error(`El archivo es demasiado grande. Máximo ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length;
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`El archivo es demasiado grande. Máximo ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`, 413);
    }
    if (realSize === 0) return error("El archivo está vacío", 422);

    const usage = await getTenantStorageUsage(tenant.slug);
    if (usage + realSize > TENANT_QUOTA_BYTES) return error("No hay espacio disponible ahora mismo.", 507);

    const documentId = randomUUID();
    const ext = extFromFileName(file.name);
    const nameRaw = formData.get("name");
    const provided = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 200) : "";
    const yaTieneExt = /\.[A-Za-z0-9]{1,10}$/.test(provided);
    const fileName = provided
      ? sanitizeFileName(yaTieneExt || !ext ? provided : `${provided}.${ext}`)
      : sanitizeFileName(file.name || "documento");

    const storagePath = await saveDocumentFile(tenant.slug, "shared", documentId, buffer, ext);

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared", // lo ve el equipo del tenant, como el resto de la ficha
        ownerUserId: null, // el paciente no es usuario del CRM
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: declaredMime,
        clientId: client.id,
        source: "ficha", // así aparece en Adjuntos de su ficha
        clientVisible: true, // es suyo: lo sigue viendo en su portal
        uploadedByClient: true,
      });
    } catch (dbErr) {
      await deleteDocumentFile(tenant.slug, storagePath);
      throw dbErr;
    }

    return created(serialize(row.toJSON()));
  } catch (err) {
    return serverError(err);
  }
});
