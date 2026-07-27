import { randomBytes, randomUUID } from "node:crypto";
import { withPublicTenant } from "@/lib/tenant/publicTenantContext.js";
import { enforceRateLimit } from "@/lib/utils/rateLimit.js";
import { ok, created, error, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { computeDueDates } from "@/lib/support/sla.js";
import { ticketRef } from "@/lib/support/serialize.js";
import {
  notifyTenantAdmins,
  emailClient,
  emailTeam,
  requestBaseUrl,
  portalTicketUrl,
} from "@/lib/support/notify.js";
import {
  MAX_TICKET_FILE_BYTES,
  saveTicketFile,
  deleteTicketFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/support/ticketStorage.js";
import { getTenantAnthropicKey } from "@/lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "@/lib/ai/anthropicModel.js";
import { ticketAiClassify } from "@/lib/support/ai.js";

/**
 * Portal público de soporte del tenant.
 *
 *   GET  /api/public/c/{tenant}/soporte  → config para pintar el formulario
 *   POST /api/public/c/{tenant}/soporte  → abrir un ticket (con adjuntos)
 *
 * Endpoint ABIERTO A INTERNET que escribe en la BD de un tenant. En este
 * orden: límite de peticiones → módulo activo → portal encendido → validación
 * → honeypot → guardar. El CORS de /api/public lo pone el middleware.
 *
 * NUNCA `getTenantContext` aquí: el tenant va en la URL (ver formularios).
 */

const MAX_PORTAL_FILES = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function cargarSettings(tenantModels) {
  const { SupportSettings } = tenantModels;
  if (!SupportSettings) return null;
  const [row] = await SupportSettings.findOrCreate({ where: {}, defaults: {} });
  return row;
}

export const GET = withPublicTenant(
  async (request, _ctx, { slug, tenant, tenantModels, hasModule, brand }) => {
    try {
      const limitado = enforceRateLimit(request, { key: `soporte-config:${slug}`, limit: 30, windowMs: 60_000 });
      if (limitado) return limitado;

      if (!hasModule(MODULE_KEYS.SUPPORT)) return notFound("Portal no disponible");
      const settings = await cargarSettings(tenantModels);
      if (!settings || !settings.portalEnabled) return notFound("Portal no disponible");

      const categories = await tenantModels.TicketCategory.findAll({
        where: { active: true },
        order: [["sortOrder", "ASC"], ["name", "ASC"]],
        attributes: ["id", "name"],
      });

      return ok({
        tenantName: tenant.name,
        brand,
        intro: settings.portalIntro || null,
        categories: categories.map((c) => ({ id: c.id, name: c.name })),
      });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);

export const POST = withPublicTenant(
  async (request, _ctx, ctx) => {
    const { slug, tenantModels, hasModule } = ctx;
    try {
      // 1. Límite por IP con cubo propio por tenant (aperturas son caras: 5/min).
      const limitado = enforceRateLimit(request, { key: `soporte-crear:${slug}`, limit: 5, windowMs: 60_000 });
      if (limitado) return limitado;

      // 2. Módulo y portal encendidos.
      if (!hasModule(MODULE_KEYS.SUPPORT)) return notFound("Portal no disponible");
      const settings = await cargarSettings(tenantModels);
      if (!settings || !settings.portalEnabled) return notFound("Portal no disponible");

      // 3. Body: multipart (con adjuntos) o JSON.
      let campos = {};
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
        for (const k of ["name", "email", "subject", "message", "categoryId", "_hp"]) {
          campos[k] = form.get(k);
        }
        files = form.getAll("files").filter((f) => f && typeof f !== "string").slice(0, MAX_PORTAL_FILES);
      } else {
        try {
          campos = await request.json();
        } catch {
          return error("No hemos podido leer los datos.");
        }
      }

      // 4. Honeypot: a un bot se le responde bien y no se guarda nada.
      if (String(campos._hp || "").trim() !== "") {
        return created({ ok: true, ref: "TK-0000" });
      }

      // 5. Validación.
      const name = String(campos.name || "").trim().slice(0, 255);
      const email = String(campos.email || "").trim().toLowerCase().slice(0, 255);
      const subject = String(campos.subject || "").trim().slice(0, 255);
      const message = String(campos.message || "").trim().slice(0, 8000);
      if (!name) return error("Dinos tu nombre.", 422);
      if (!EMAIL_RE.test(email)) return error("Necesitamos un email válido para responderte.", 422);
      if (!subject) return error("Resume en una línea qué necesitas.", 422);
      if (!message) return error("Cuéntanos qué pasa.", 422);

      const categoryId =
        campos.categoryId && (await tenantModels.TicketCategory.findOne({ where: { id: String(campos.categoryId), active: true } }).catch(() => null))
          ? String(campos.categoryId)
          : null;

      for (const f of files) {
        if (typeof f.size === "number" && f.size > MAX_TICKET_FILE_BYTES) {
          return error(`"${f.name}" supera los ${MAX_TICKET_FILE_BYTES / (1024 * 1024)} MB`, 413);
        }
      }

      // 6. Matching con la ficha: por email del contacto, o de la ficha misma.
      const { Ticket, TicketAttachment, Client, Contact } = tenantModels;
      let clientId = null;
      let contactId = null;
      try {
        const contacto = await Contact.findOne({ where: { email } });
        if (contacto) {
          contactId = contacto.id;
          clientId = contacto.clientId || null;
        } else {
          const ficha = await Client.findOne({ where: { email } });
          if (ficha) clientId = ficha.id;
        }
      } catch {
        /* sin match: el ticket nace suelto, con requester */
      }

      // 7. Crear con SLA y token de seguimiento.
      const dues = computeDueDates("medium", settings);
      const ticket = await Ticket.create({
        title: subject,
        description: message,
        clientId,
        contactId,
        categoryId,
        priority: "medium",
        status: "open",
        channel: "portal",
        portalToken: randomBytes(24).toString("base64url"),
        requesterName: name,
        requesterEmail: email,
        firstResponseDueAt: dues.firstResponseDueAt,
        resolutionDueAt: dues.resolutionDueAt,
        lastMessageAt: new Date(),
      });

      // 8. Adjuntos de la apertura (messageId null = de la descripción).
      for (const f of files) {
        const attachmentId = randomUUID();
        const buffer = Buffer.from(await f.arrayBuffer());
        if (buffer.length > MAX_TICKET_FILE_BYTES) continue;
        const storagePath = await saveTicketFile(slug, ticket.id, attachmentId, buffer, extFromFileName(f.name));
        try {
          await TicketAttachment.create({
            id: attachmentId,
            ticketId: ticket.id,
            messageId: null,
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

      // 9. Clasificación automática SOLO si el tenant la activó (opt-in) y hay
      //    clave BYOK. Best-effort con presupuesto corto: jamás bloquea el alta.
      if (settings.autoClassify) {
        try {
          const apiKey = getTenantAnthropicKey(ctx);
          if (apiKey) {
            const categories = await tenantModels.TicketCategory.findAll({ where: { active: true }, raw: true });
            const sugerencia = await ticketAiClassify({
              ticket: ticket.toJSON(),
              categories,
              apiKey,
              model: getTenantAnthropicModel(ctx),
            });
            if (sugerencia) {
              const cambios = {};
              if (sugerencia.priority && sugerencia.priority !== ticket.priority) {
                cambios.priority = sugerencia.priority;
                const nuevos = computeDueDates(sugerencia.priority, settings, ticket.createdAt);
                cambios.firstResponseDueAt = nuevos.firstResponseDueAt;
                cambios.resolutionDueAt = nuevos.resolutionDueAt;
              }
              if (sugerencia.categoryId && !ticket.categoryId) cambios.categoryId = sugerencia.categoryId;
              if (Object.keys(cambios).length) await ticket.update(cambios);
            }
          }
        } catch {
          /* la IA nunca rompe el alta */
        }
      }

      // 10. Avisos, sin bloquear la respuesta: confirmación al cliente,
      //     campana a los admins y email interno a los configurados.
      const baseUrl = requestBaseUrl(request);
      emailClient({ ctx, ticket, kind: "created", baseUrl }).catch(() => {});
      notifyTenantAdmins({
        ctx,
        type: "ticket_new",
        title: "Nuevo ticket del portal",
        body: `${ticketRef(ticket.number)} · ${ticket.title}`,
        ticketId: ticket.id,
      }).catch(() => {});
      const avisos = Array.isArray(settings.notifyEmails) ? settings.notifyEmails : [];
      if (avisos.length) {
        emailTeam({ ctx, ticket, kind: "new_portal", to: avisos, preview: message, baseUrl }).catch(() => {});
      }

      return created({
        ok: true,
        ref: ticketRef(ticket.number),
        followUrl: portalTicketUrl(baseUrl, slug, ticket.portalToken),
      });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: false }
);
