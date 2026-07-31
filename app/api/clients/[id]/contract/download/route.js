import { Readable } from "node:stream";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { readDocumentStream } from "../../../../../../lib/documents/documentStorage.js";
import { findClientContract } from "../../../../../../lib/clients/clientContract.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/clients/[id]/contract/download — descarga el PDF del contrato de la
 * familia por STREAM (no bufferiza: sirve 25 MB sin doblar la RAM).
 *
 * Va en su propia ruta y no en el GET del contrato porque ese devuelve JSON con
 * el estado de firma, que es lo que pinta la ficha.
 */
export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!ctx.hasModule("clients")) return forbidden("Módulo clients no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client, Document } = ctx.tenantModels;
    const cliente = await Client.findByPk(id, { attributes: ["id", "contractDocumentId"] });
    if (!cliente) return notFound("Cliente no encontrado");

    const doc = await findClientContract(Document, cliente);
    if (!doc) return notFound("Este cliente no tiene contrato subido");

    let stream;
    let size;
    try {
      ({ stream, size } = await readDocumentStream(ctx.tenant.slug, doc.storagePath));
    } catch (err) {
      if (err.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw err;
    }

    const safeName = String(doc.fileName || "contrato.pdf").replace(/[\r\n"]/g, "_");
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
