import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { created, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { currentAuthor, ticketIncludes, UUID_RE } from "@/lib/support/context.js";
import { serializeMessage } from "@/lib/support/serialize.js";
import { emailClient, requestBaseUrl } from "@/lib/support/notify.js";
import {
  MAX_TICKET_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  saveTicketFile,
  deleteTicketFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/support/ticketStorage.js";

/**
 * POST /api/tickets/[id]/messages — añadir al hilo desde el CRM.
 *
 * Acepta JSON { body, isInternal, sendEmail } o multipart (mismos campos + files[]).
 *
 * Una RESPUESTA (isInternal=false):
 *   - marca la primera respuesta del SLA si es la primera,
 *   - pasa el ticket a "waiting" (la pelota queda en el tejado del cliente),
 *   - si `sendEmail` !== false, envía el email al cliente vía Resend con su
 *     enlace del portal (resultado anotado: sent/failed/skipped). Con
 *     `sendEmail: false` la respuesta SOLO queda en el hilo (emailStatus
 *     "manual"): para cuando el equipo contesta desde su propio buzón
 *     (Outlook/Gmail) y no quiere gastar envíos de Resend.
 * Una NOTA INTERNA no toca estado, ni SLA, ni envía nada.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Ticket, TicketMessage, TicketAttachment } = ctx.tenantModels;
    const ticket = await Ticket.findByPk(id, { include: ticketIncludes(ctx.tenantModels) });
    if (!ticket) return notFound("Ticket no encontrado");

    // ── Leer body: multipart (con adjuntos) o JSON ────────────────────────────
    let texto = "";
    let isInternal = false;
    let quiereEmail = true;
    let files = [];
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > (MAX_TICKET_FILE_BYTES + 512 * 1024) * MAX_FILES_PER_MESSAGE) {
        return error(`Adjuntos demasiado grandes (máx. ${MAX_FILES_PER_MESSAGE} × ${MAX_TICKET_FILE_BYTES / (1024 * 1024)} MB)`, 413);
      }
      let form;
      try {
        form = await request.formData();
      } catch {
        return error("Body multipart inválido", 400);
      }
      texto = String(form.get("body") || "").trim();
      isInternal = String(form.get("isInternal")) === "true";
      quiereEmail = String(form.get("sendEmail")) !== "false";
      files = form.getAll("files").filter((f) => f && typeof f !== "string");
    } else {
      let body;
      try {
        body = await request.json();
      } catch {
        return error("Body JSON inválido");
      }
      texto = String(body?.body || "").trim();
      isInternal = body?.isInternal === true;
      quiereEmail = body?.sendEmail !== false;
    }

    if (!texto && files.length === 0) return error("El mensaje no puede estar vacío", 422);
    if (files.length > MAX_FILES_PER_MESSAGE) {
      return error(`Máximo ${MAX_FILES_PER_MESSAGE} adjuntos por mensaje`, 422);
    }
    for (const f of files) {
      if (typeof f.size === "number" && f.size > MAX_TICKET_FILE_BYTES) {
        return error(`"${f.name}" supera los ${MAX_TICKET_FILE_BYTES / (1024 * 1024)} MB`, 413);
      }
    }

    const autor = await currentAuthor(request, ctx.tenantModels);
    const ahora = new Date();

    const mensaje = await TicketMessage.create({
      ticketId: ticket.id,
      authorType: "team",
      authorUserId: autor.userId,
      authorName: autor.name,
      body: texto || "(adjuntos)",
      isInternal,
    });

    // Adjuntos a disco + metadatos. Si uno falla, se limpia y se corta.
    const adjuntos = [];
    for (const f of files) {
      const attachmentId = randomUUID();
      const buffer = Buffer.from(await f.arrayBuffer());
      if (buffer.length > MAX_TICKET_FILE_BYTES) {
        return error(`"${f.name}" supera los ${MAX_TICKET_FILE_BYTES / (1024 * 1024)} MB`, 413);
      }
      const ext = extFromFileName(f.name);
      const storagePath = await saveTicketFile(ctx.slug, ticket.id, attachmentId, buffer, ext);
      try {
        const fila = await TicketAttachment.create({
          id: attachmentId,
          ticketId: ticket.id,
          messageId: mensaje.id,
          fileName: sanitizeFileName(f.name),
          storagePath,
          fileSize: buffer.length,
          mimeType: f.type || "application/octet-stream",
          uploadedByType: "team",
        });
        adjuntos.push(fila);
      } catch (dbErr) {
        await deleteTicketFile(storagePath);
        throw dbErr;
      }
    }

    // ── Efectos sobre el ticket ───────────────────────────────────────────────
    const cambios = { lastMessageAt: ahora };
    if (!isInternal) {
      if (!ticket.firstResponseAt) cambios.firstResponseAt = ahora;
      if (ticket.status === "open" || ticket.status === "in_progress") cambios.status = "waiting";
    }
    await ticket.update(cambios);

    // Email al cliente (solo respuestas públicas), con resultado anotado.
    // "manual" = el agente eligió NO enviarlo por Resend (responderá desde su
    // buzón, o simplemente lo deja registrado).
    if (!isInternal) {
      if (quiereEmail) {
        const resultado = await emailClient({
          ctx,
          ticket,
          kind: "reply",
          replyBody: texto,
          baseUrl: requestBaseUrl(request),
        });
        await mensaje.update({ emailStatus: resultado }).catch(() => {});
      } else {
        await mensaje.update({ emailStatus: "manual" }).catch(() => {});
      }
    }

    const full = await TicketMessage.findByPk(mensaje.id, {
      include: [{ model: TicketAttachment, as: "attachments", required: false }],
    });
    return created({
      message: serializeMessage(full),
      ticketStatus: cambios.status || ticket.status,
      firstResponseAt: ticket.firstResponseAt,
    });
  } catch (err) {
    return serverError(err);
  }
});
