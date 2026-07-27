import { randomUUID } from "node:crypto";
import { withPublicTenant } from "@/lib/tenant/publicTenantContext.js";
import { enforceRateLimit } from "@/lib/utils/rateLimit.js";
import { ok, created, error, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { serializePortalTicket, ticketRef } from "@/lib/support/serialize.js";
import { notifyUser, notifyTenantAdmins, emailTeam, teamMemberUser, requestBaseUrl } from "@/lib/support/notify.js";
import {
  MAX_TICKET_FILE_BYTES,
  saveTicketFile,
  deleteTicketFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/support/ticketStorage.js";

/**
 * Seguimiento público de UN ticket por token (el enlace que va en los emails).
 *
 *   GET  /api/public/c/{tenant}/soporte/t/{token}  → estado + hilo público
 *   POST /api/public/c/{tenant}/soporte/t/{token}  → responder (con adjuntos)
 *
 * El token es la única llave: 32 chars aleatorios URL-safe, único por ticket.
 * Nunca se listan tickets aquí; token inválido = 404 sin más pistas.
 */

const MAX_PORTAL_FILES = 3;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function cargarTicket(tenantModels, token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const { Ticket } = tenantModels;
  return Ticket.findOne({ where: { portalToken: String(token) } });
}

export const GET = withPublicTenant(
  async (request, routeCtx, { slug, tenantModels, hasModule }) => {
    try {
      const limitado = enforceRateLimit(request, { key: `soporte-ver:${slug}`, limit: 30, windowMs: 60_000 });
      if (limitado) return limitado;
      if (!hasModule(MODULE_KEYS.SUPPORT)) return notFound("No disponible");

      const { token } = await routeCtx.params;
      const ticket = await cargarTicket(tenantModels, token);
      if (!ticket) return notFound("Solicitud no encontrada");

      const { TicketMessage, TicketAttachment } = tenantModels;
      const [messages, attachments] = await Promise.all([
        TicketMessage.findAll({ where: { ticketId: ticket.id }, order: [["createdAt", "ASC"]], limit: 300 }),
        TicketAttachment.findAll({ where: { ticketId: ticket.id }, limit: 100 }),
      ]);

      return ok(serializePortalTicket(ticket, messages, attachments));
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);

export const POST = withPublicTenant(
  async (request, routeCtx, ctx) => {
    const { slug, tenantModels, hasModule } = ctx;
    try {
      const limitado = enforceRateLimit(request, { key: `soporte-responder:${slug}`, limit: 10, windowMs: 60_000 });
      if (limitado) return limitado;
      if (!hasModule(MODULE_KEYS.SUPPORT)) return notFound("No disponible");

      const { token } = await routeCtx.params;
      const ticket = await cargarTicket(tenantModels, token);
      if (!ticket) return notFound("Solicitud no encontrada");
      if (ticket.status === "closed") {
        return error("Esta solicitud está cerrada. Abre una nueva si necesitas algo más.", 409);
      }

      // Body: multipart (con adjuntos) o JSON.
      let texto = "";
      let files = [];
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > (MAX_TICKET_FILE_BYTES + 512 * 1024) * MAX_PORTAL_FILES) {
          return error("Adjuntos demasiado grandes", 413);
        }
        let form;
        try {
          form = await request.formData();
        } catch {
          return error("No hemos podido leer el formulario.");
        }
        texto = String(form.get("body") || "").trim().slice(0, 8000);
        files = form.getAll("files").filter((f) => f && typeof f !== "string").slice(0, MAX_PORTAL_FILES);
      } else {
        let body;
        try {
          body = await request.json();
        } catch {
          return error("No hemos podido leer los datos.");
        }
        texto = String(body?.body || "").trim().slice(0, 8000);
      }
      if (!texto && files.length === 0) return error("Escribe algo o adjunta un archivo.", 422);
      for (const f of files) {
        if (typeof f.size === "number" && f.size > MAX_TICKET_FILE_BYTES) {
          return error(`"${f.name}" supera los ${MAX_TICKET_FILE_BYTES / (1024 * 1024)} MB`, 413);
        }
      }

      const { TicketMessage, TicketAttachment, TeamMember } = tenantModels;
      const mensaje = await TicketMessage.create({
        ticketId: ticket.id,
        authorType: "client",
        authorName: ticket.requesterName || "Cliente",
        body: texto || "(adjuntos)",
        isInternal: false,
      });

      for (const f of files) {
        const attachmentId = randomUUID();
        const buffer = Buffer.from(await f.arrayBuffer());
        if (buffer.length > MAX_TICKET_FILE_BYTES) continue;
        const storagePath = await saveTicketFile(slug, ticket.id, attachmentId, buffer, extFromFileName(f.name));
        try {
          await TicketAttachment.create({
            id: attachmentId,
            ticketId: ticket.id,
            messageId: mensaje.id,
            fileName: sanitizeFileName(f.name),
            storagePath,
            fileSize: buffer.length,
            mimeType: f.type || "application/octet-stream",
            uploadedByType: "client",
          });
        } catch {
          await deleteTicketFile(storagePath);
        }
      }

      // El cliente ha hablado: la pelota vuelve al equipo. Reabre si estaba
      // "waiting" o "resolved" (responder a un resuelto = no estaba resuelto).
      const cambios = { lastMessageAt: new Date() };
      if (ticket.status === "waiting" || ticket.status === "resolved") {
        cambios.status = "open";
        cambios.resolvedAt = null;
        cambios.closedAt = null;
      }
      await ticket.update(cambios);

      // Avisos al equipo: asignado si lo hay; si no, admins. Best-effort.
      const baseUrl = requestBaseUrl(request);
      const preview = texto || "(adjuntos)";
      (async () => {
        if (ticket.assignedTo) {
          const assignee = await TeamMember.findByPk(ticket.assignedTo).catch(() => null);
          const user = assignee ? await teamMemberUser(assignee) : null;
          if (user?.id) {
            await notifyUser({
              tenantModels,
              userId: user.id,
              type: "ticket_reply",
              title: "El cliente ha respondido",
              body: `${ticketRef(ticket.number)} · ${ticket.title}`,
              ticketId: ticket.id,
            });
          }
          if (user?.email) {
            await emailTeam({ ctx, ticket, kind: "client_reply", to: user.email, preview, baseUrl });
          }
        } else {
          await notifyTenantAdmins({
            ctx,
            type: "ticket_reply",
            title: "El cliente ha respondido",
            body: `${ticketRef(ticket.number)} · ${ticket.title}`,
            ticketId: ticket.id,
          });
        }
      })().catch(() => {});

      return created({ ok: true, status: cambios.status || ticket.status });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);
