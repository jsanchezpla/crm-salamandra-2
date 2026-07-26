import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../lib/documents/documentStorage.js";

const SOURCE = "contract_template";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/pacientes/contract-template/download
 * Sirve el contrato estándar de la clínica por STREAM.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    const { Document } = ctx.tenantModels;
    const row = await Document.findOne({ where: { source: SOURCE }, order: [["createdAt", "DESC"]] });
    if (!row) return notFound("No hay contrato estándar configurado");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, row.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const safeName = String(row.fileName || "contrato").replace(/[\r\n"]/g, "_");
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
