import { Readable } from "node:stream";
import { withPublicTenant } from "@/lib/tenant/publicTenantContext.js";
import { enforceRateLimit } from "@/lib/utils/rateLimit.js";
import { error, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { openTicketFileStream } from "@/lib/support/ticketStorage.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/public/c/{tenant}/soporte/t/{token}/attachments/{attachmentId}
 *
 * Descarga pública de un adjunto, con doble candado: el adjunto debe ser del
 * ticket de ESE token, y no puede colgar de una nota interna. Siempre como
 * attachment + nosniff.
 */
export const GET = withPublicTenant(
  async (request, routeCtx, { slug, tenantModels, hasModule }) => {
    try {
      const limitado = enforceRateLimit(request, { key: `soporte-adjunto:${slug}`, limit: 30, windowMs: 60_000 });
      if (limitado) return limitado;
      if (!hasModule(MODULE_KEYS.SUPPORT)) return notFound("No disponible");

      const { token, attachmentId } = await routeCtx.params;
      if (!TOKEN_RE.test(String(token || "")) || !UUID_RE.test(String(attachmentId || ""))) {
        return error("Parámetros inválidos", 400);
      }

      const { Ticket, TicketAttachment, TicketMessage } = tenantModels;
      const ticket = await Ticket.findOne({ where: { portalToken: String(token) } });
      if (!ticket) return notFound("Solicitud no encontrada");

      const adj = await TicketAttachment.findOne({ where: { id: attachmentId, ticketId: ticket.id } });
      if (!adj) return notFound("Adjunto no encontrado");
      if (adj.messageId) {
        const msg = await TicketMessage.findByPk(adj.messageId, { attributes: ["id", "isInternal"] });
        if (!msg || msg.isInternal) return notFound("Adjunto no encontrado");
      }

      let stream;
      let size;
      try {
        ({ stream, size } = await openTicketFileStream(adj.storagePath));
      } catch (e) {
        if (e.code === "ENOENT") return notFound("Archivo no encontrado");
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
  },
  { rateLimit: false }
);
