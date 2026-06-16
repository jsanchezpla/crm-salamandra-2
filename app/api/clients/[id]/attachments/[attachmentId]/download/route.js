import { NextResponse } from "next/server";
import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { readAttachment } from "../../../../../../../lib/clients/attachmentStorage.js";

/**
 * GET /api/clients/[id]/attachments/[attachmentId]/download
 *
 * Stream del PDF al cliente con Content-Disposition: attachment.
 * El nombre que ve el usuario es el `originalName` con que subió el archivo.
 *
 * Requiere JWT + módulo clients. Cualquier admin del tenant puede descargar
 * (la auditoría de quién descarga queda fuera del scope; apuntado al backlog).
 */
export const GET = withTenant(
  async (_request, { params }, { tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("clients")) return forbidden("Módulo clients no activo");
      const { id, attachmentId } = await params;
      const { ClientAttachment } = tenantModels;

      const row = await ClientAttachment.findOne({
        where: { id: attachmentId, clientId: id },
      });
      if (!row) return notFound("Attachment no encontrado");

      let buffer;
      try {
        buffer = await readAttachment(tenant.slug, id, row.storedFilename);
      } catch (err) {
        if (err.code === "ENOENT") {
          // Hay registro en BD pero el archivo físico falta — caso de
          // datos inconsistentes (volumen perdido, restore parcial).
          return notFound("Archivo físico no encontrado");
        }
        throw err;
      }

      // Sanitizar el filename para el header (evitar caracteres ilegales).
      const safeName = row.originalName.replace(/[\r\n"]/g, "_");

      const ab = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

      return new NextResponse(ab, {
        status: 200,
        headers: {
          "Content-Type": row.mimeType || "application/pdf",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Content-Length": String(buffer.length),
          "Cache-Control": "private, no-cache",
        },
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
