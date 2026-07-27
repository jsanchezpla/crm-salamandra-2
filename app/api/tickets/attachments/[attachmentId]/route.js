import { Readable } from "node:stream";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { UUID_RE } from "@/lib/support/context.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { openTicketFileStream } from "@/lib/support/ticketStorage.js";

/**
 * GET /api/tickets/attachments/[attachmentId] — descarga interna por STREAM.
 * Siempre como attachment + nosniff: un adjunto jamás se ejecuta en el navegador.
 */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { attachmentId } = await params;
    if (!UUID_RE.test(attachmentId)) return error("id inválido", 400);

    const { TicketAttachment } = ctx.tenantModels;
    const adj = await TicketAttachment.findByPk(attachmentId);
    if (!adj) return notFound("Adjunto no encontrado");

    let stream;
    let size;
    try {
      ({ stream, size } = await openTicketFileStream(adj.storagePath));
    } catch (e) {
      if (e.code === "ENOENT") return notFound("Archivo físico no encontrado");
      throw e;
    }

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": adj.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition("attachment", adj.fileName),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
