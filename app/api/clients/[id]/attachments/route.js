import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  ok,
  created,
  error,
  forbidden,
  notFound,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import {
  ALLOWED_MIME,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_CLIENT,
  generateStoredFilename,
  writeAttachment,
  deleteAttachmentFile,
} from "../../../../../lib/clients/attachmentStorage.js";

/**
 * GET /api/clients/[id]/attachments — lista de PDFs del cliente.
 * Orden DESC por createdAt. No pagina (max 50 por cliente).
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("clients")) return forbidden("Módulo clients no activo");
    const { id } = await params;
    const { Client, ClientAttachment } = tenantModels;

    const client = await Client.findByPk(id, { attributes: ["id"] });
    if (!client) return notFound("Cliente no encontrado");

    const rows = await ClientAttachment.findAll({
      where: { clientId: id },
      order: [["createdAt", "DESC"]],
    });

    return ok({
      attachments: rows.map((r) => r.toJSON()),
      total: rows.length,
      limit: MAX_FILES_PER_CLIENT,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * POST /api/clients/[id]/attachments — sube un PDF.
 * multipart/form-data, campo "file".
 *
 * Validaciones:
 *   - mimeType === "application/pdf"
 *   - fileSize ≤ 10 MB
 *   - count actual < 50
 *
 * Orden de operaciones (best-effort atómico):
 *   1. Validar.
 *   2. Generar storedFilename.
 *   3. Escribir archivo a disco.
 *   4. Insertar fila BD.
 *   5. Si BD falla → borrar archivo (best effort).
 */
export const POST = withTenant(
  async (request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id } = await params;
      const { Client, ClientAttachment } = tenantModels;
      const uploadedBy = request.headers.get("x-user-email") ?? null;

      const client = await Client.findByPk(id, { attributes: ["id"] });
      if (!client) return notFound("Cliente no encontrado");

      // Comprobar límite ANTES de leer el archivo (no malgastar bytes).
      const currentCount = await ClientAttachment.count({ where: { clientId: id } });
      if (currentCount >= MAX_FILES_PER_CLIENT) {
        return error(
          `Límite alcanzado: máximo ${MAX_FILES_PER_CLIENT} archivos por cliente`,
          422
        );
      }

      let formData;
      try {
        formData = await request.formData();
      } catch {
        return error("Body inválido: se esperaba multipart/form-data", 400);
      }

      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return error("Campo 'file' obligatorio (multipart)", 422);
      }

      if (file.type !== ALLOWED_MIME) {
        return error(
          `Tipo no permitido: solo ${ALLOWED_MIME}. Recibido: ${file.type || "desconocido"}`,
          422
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(2);
        return error(
          `Archivo demasiado grande: ${mb} MB. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
          422
        );
      }

      const originalName = (file.name || "archivo.pdf").slice(0, 255);
      const storedFilename = generateStoredFilename();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // ── 3. Escribir archivo a disco ──────────────────────────────────────
      await writeAttachment(tenant.slug, id, storedFilename, buffer);

      // ── 4. Insertar fila BD; si falla, intentar limpiar el archivo ──────
      let row;
      try {
        row = await ClientAttachment.create({
          clientId: id,
          originalName,
          storedFilename,
          mimeType: file.type,
          fileSize: file.size,
          uploadedBy,
        });
      } catch (dbErr) {
        await deleteAttachmentFile(tenant.slug, id, storedFilename);
        throw dbErr;
      }

      process.stdout.write(
        `[clients:attachment] uploaded tenant=${tenant.slug} client=${id} file=${row.id} size=${file.size}\n`
      );

      return created(row.toJSON());
    } catch (err) {
      return serverError(err);
    }
  }
);
