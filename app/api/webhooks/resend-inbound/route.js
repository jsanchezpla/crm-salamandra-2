import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { ok, error, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { getPublicTenantContext } from "@/lib/tenant/publicTenantContext.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { enforceRateLimit } from "@/lib/utils/rateLimit.js";
import { computeDueDates } from "@/lib/support/sla.js";
import { ticketRef } from "@/lib/support/serialize.js";
import {
  notifyTeamOfClientReply,
  notifyTenantAdmins,
  emailClient,
  requestBaseUrl,
} from "@/lib/support/notify.js";
import {
  MAX_TICKET_FILE_BYTES,
  saveTicketFile,
  deleteTicketFile,
  sanitizeFileName,
  extFromFileName,
} from "@/lib/support/ticketStorage.js";
import { getMasterModels } from "@/lib/db/masterDb.js";

/**
 * POST /api/webhooks/resend-inbound — CORREO ENTRANTE del módulo Soporte.
 *
 * Resend recibe todo lo que llega al dominio inbound (RESEND_INBOUND_DOMAIN,
 * p. ej. inbound.salamandrasolutions.com) y lo reenvía aquí como webhook
 * firmado (svix). Cada tenant tiene su dirección de captura:
 *
 *     soporte-{slug}@{RESEND_INBOUND_DOMAIN}
 *
 * Llega correo ahí por dos caminos: (a) el cliente respondió a un email del
 * CRM cuyo reply-to era la captura, o (b) el buzón PROPIO del tenant
 * (soporte@empresa.com) reenvía/CC-a lo suyo hacia la captura — así la
 * conversación puede vivir en Outlook/Gmail y aun así quedar ENTERA en el
 * hilo del CRM.
 *
 * Matching, en orden: nº de ticket en el asunto (TK-0042) → remitente con
 * ticket activo → si nada casa, se ABRE ticket nuevo (email-to-ticket).
 * El autor se clasifica: remitente ∈ {supportEmail del tenant, emails de sus
 * usuarios o de su equipo} → mensaje del EQUIPO "por correo" (con su email
 * visible, para que quede claro quién escribió); resto → mensaje del CLIENTE.
 *
 * Seguridad: firma svix obligatoria (RESEND_WEBHOOK_SECRET) + rate limit.
 * Tras firma válida SIEMPRE se responde 200 (aunque no se procese): un 4xx/5xx
 * pondría a Resend a reintentar para siempre correos que jamás vamos a querer.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Firma svix (implementación mínima, sin dependencia) ─────────────────────
function verifySvixSignature({ secret, id, timestamp, signature, payload }) {
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false; // ±5 min
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  const expected = Buffer.from(signed);
  // El header lista una o varias firmas: "v1,BASE64 v1,BASE64…"
  for (const parte of String(signature).split(" ")) {
    const [version, sig] = parte.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig);
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

// ── Helpers de parseo de direcciones (el formato varía entre payloads) ──────
function parseAddress(v) {
  if (!v) return { email: null, name: null };
  if (typeof v === "object") {
    const email = String(v.email || v.address || "").trim().toLowerCase();
    return { email: EMAIL_RE.test(email) ? email : null, name: String(v.name || "").trim() || null };
  }
  const s = String(v).trim();
  const m = s.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (m) {
    const email = m[2].trim().toLowerCase();
    return { email: EMAIL_RE.test(email) ? email : null, name: (m[1] || "").trim() || null };
  }
  const email = s.toLowerCase();
  return { email: EMAIL_RE.test(email) ? email : null, name: null };
}

function listAddresses(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(parseAddress).filter((a) => a.email);
}

/** Quita la cadena citada de un reply ("El lun... escribió:", "> ..."). Best-effort. */
function stripQuotedReply(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    // Encabezados de cita habituales (Gmail/Outlook, es/en) en cualquier orden:
    // "El lun, 27 jul 2026, X escribió:", "... escribió soporte:", "On ... wrote:"
    if (/^\s*(El\s.+escribi[oó].*:|On\s.+wrote.*:|-{2,}\s*Original Message|De:\s.+|From:\s.+)\s*$/i.test(line)) break;
    out.push(line);
  }
  // Cola de líneas citadas sueltas
  while (out.length && /^\s*(>|$)/.test(out[out.length - 1])) out.pop();
  return out.join("\n").trim();
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ¿El remitente es del EQUIPO del tenant? (supportEmail, users master o team_members) */
async function isTeamSender(ctx, settings, email) {
  if (!email) return false;
  if (String(settings?.supportEmail || "").trim().toLowerCase() === email) return true;
  try {
    const { User } = getMasterModels();
    const u = await User.findOne({ where: { tenantId: ctx.tenant.id, email }, attributes: ["id"] });
    if (u) return true;
  } catch { /* sigue */ }
  try {
    const tm = await ctx.tenantModels.TeamMember.findOne({ where: { email }, attributes: ["id"] });
    if (tm) return true;
  } catch { /* sigue */ }
  return false;
}

export async function POST(request) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return error("Webhook de correo entrante no configurado", 503);

    const limitado = enforceRateLimit(request, { key: "resend-inbound", limit: 60, windowMs: 60_000 });
    if (limitado) return limitado;

    const payload = await request.text();
    const firmaOk = verifySvixSignature({
      secret,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
      payload,
    });
    if (!firmaOk) return unauthorized("Firma inválida");

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return ok({ processed: false, reason: "payload no JSON" });
    }
    const data = event?.data;
    if (!data || (event?.type && !String(event.type).includes("received"))) {
      return ok({ processed: false, reason: "evento ignorado" });
    }

    // ── ¿Para qué tenant viene? soporte-{slug}@dominio en to/cc ─────────────
    const domain = (process.env.RESEND_INBOUND_DOMAIN || "").trim().toLowerCase();
    const destinos = [...listAddresses(data.to), ...listAddresses(data.cc), ...listAddresses(data.bcc)];
    let slug = null;
    for (const d of destinos) {
      const m = d.email.match(/^soporte-([a-z0-9_]+)@(.+)$/);
      if (m && (!domain || m[2] === domain)) {
        slug = m[1];
        break;
      }
    }
    if (!slug) return ok({ processed: false, reason: "sin dirección de captura" });

    let ctx;
    try {
      ctx = await getPublicTenantContext(slug);
    } catch {
      return ok({ processed: false, reason: "tenant desconocido" });
    }
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return ok({ processed: false, reason: "módulo inactivo" });

    const { Ticket, TicketMessage, TicketAttachment, SupportSettings, Client, Contact } = ctx.tenantModels;
    const [settings] = await SupportSettings.findOrCreate({ where: {}, defaults: {} });

    const from = parseAddress(data.from);
    if (!from.email) return ok({ processed: false, reason: "remitente ilegible" });
    const subject = String(data.subject || "").trim().slice(0, 255) || "(sin asunto)";
    const cuerpoCrudo = data.text ? String(data.text) : htmlToText(data.html);
    const cuerpo = stripQuotedReply(cuerpoCrudo).slice(0, 8000);

    // ── Matching de ticket ──────────────────────────────────────────────────
    let ticket = null;
    const num = subject.match(/TK-?\s*(\d{1,9})/i);
    if (num) {
      ticket = await Ticket.findOne({ where: { number: Number(num[1]) } });
    }
    if (!ticket) {
      ticket = await Ticket.findOne({
        where: {
          requesterEmail: from.email,
          status: ["open", "in_progress", "waiting", "resolved"],
        },
        order: [["lastMessageAt", "DESC"]],
      });
    }

    const esEquipo = await isTeamSender(ctx, settings, from.email);
    const baseUrl = requestBaseUrl(request);
    let accion;

    if (!ticket) {
      // Email-to-ticket: correo nuevo de un cliente → se abre solicitud. Del
      // equipo NO se abren tickets (un CC interno suelto no debe crear ruido).
      if (esEquipo) return ok({ processed: false, reason: "correo interno sin ticket" });
      if (!cuerpo && !subject) return ok({ processed: false, reason: "correo vacío" });

      let clientId = null;
      let contactId = null;
      try {
        const contacto = await Contact.findOne({ where: { email: from.email } });
        if (contacto) {
          contactId = contacto.id;
          clientId = contacto.clientId || null;
        } else {
          const ficha = await Client.findOne({ where: { email: from.email } });
          if (ficha) clientId = ficha.id;
        }
      } catch { /* sin match */ }

      const dues = computeDueDates("medium", settings);
      ticket = await Ticket.create({
        title: subject,
        description: cuerpo || "(correo sin texto)",
        clientId,
        contactId,
        priority: "medium",
        status: "open",
        channel: "email",
        portalToken: randomUUID().replace(/-/g, ""),
        requesterName: from.name || from.email,
        requesterEmail: from.email,
        firstResponseDueAt: dues.firstResponseDueAt,
        resolutionDueAt: dues.resolutionDueAt,
        lastMessageAt: new Date(),
      });
      accion = "ticket_creado";

      emailClient({ ctx, ticket, kind: "created", baseUrl, settings }).catch(() => {});
      notifyTenantAdmins({
        ctx,
        type: "ticket_new",
        title: "Nuevo ticket por correo",
        body: `${ticketRef(ticket.number)} · ${ticket.title}`,
        ticketId: ticket.id,
      }).catch(() => {});
    } else {
      // Dedupe de reintentos del webhook: mismo hilo, mismo texto, <10 min.
      if (cuerpo) {
        const repetido = await TicketMessage.findOne({
          where: {
            ticketId: ticket.id,
            via: "email",
            body: cuerpo,
            createdAt: { [Op.gt]: new Date(Date.now() - 10 * 60_000) },
          },
        });
        if (repetido) return ok({ processed: false, reason: "duplicado" });
      }

      const mensaje = await TicketMessage.create({
        ticketId: ticket.id,
        authorType: esEquipo ? "team" : "client",
        authorName: from.name || from.email,
        authorEmail: from.email,
        body: cuerpo || "(correo sin texto)",
        isInternal: false,
        via: "email",
      });

      // Adjuntos SOLO si vienen inline en el payload (content base64). Si el
      // proveedor manda solo referencias, se deja constancia en el hilo.
      const adjuntos = Array.isArray(data.attachments) ? data.attachments.slice(0, 5) : [];
      let sinImportar = 0;
      for (const adj of adjuntos) {
        const contenido = adj?.content;
        if (!contenido || typeof contenido !== "string") {
          sinImportar++;
          continue;
        }
        try {
          const buffer = Buffer.from(contenido, "base64");
          if (!buffer.length || buffer.length > MAX_TICKET_FILE_BYTES) {
            sinImportar++;
            continue;
          }
          const attachmentId = randomUUID();
          const nombre = adj.filename || adj.name || "adjunto.bin";
          const storagePath = await saveTicketFile(ctx.slug, ticket.id, attachmentId, buffer, extFromFileName(nombre));
          try {
            await TicketAttachment.create({
              id: attachmentId,
              ticketId: ticket.id,
              messageId: mensaje.id,
              fileName: sanitizeFileName(nombre),
              storagePath,
              fileSize: buffer.length,
              mimeType: adj.content_type || adj.contentType || "application/octet-stream",
              uploadedByType: esEquipo ? "team" : "client",
            });
          } catch {
            await deleteTicketFile(storagePath);
            sinImportar++;
          }
        } catch {
          sinImportar++;
        }
      }
      if (sinImportar > 0) {
        await mensaje.update({ body: `${mensaje.body}\n\n(${sinImportar} adjunto${sinImportar === 1 ? "" : "s"} del correo no importado${sinImportar === 1 ? "" : "s"})` }).catch(() => {});
      }

      // Efectos según quién habló.
      const cambios = { lastMessageAt: new Date() };
      if (esEquipo) {
        // El equipo respondió desde su buzón: cuenta como primera respuesta y
        // deja la pelota en el cliente. No se reenvía nada (ya salió de su Outlook).
        if (!ticket.firstResponseAt) cambios.firstResponseAt = new Date();
        if (ticket.status === "open" || ticket.status === "in_progress") cambios.status = "waiting";
        accion = "respuesta_equipo";
      } else {
        if (ticket.status === "waiting" || ticket.status === "resolved") {
          cambios.status = "open";
          cambios.resolvedAt = null;
          cambios.closedAt = null;
        }
        accion = "respuesta_cliente";
      }
      await ticket.update(cambios);

      if (!esEquipo) {
        notifyTeamOfClientReply({ ctx, ticket, preview: cuerpo || "(adjuntos)", baseUrl }).catch(() => {});
      }
    }

    return ok({ processed: true, action: accion, ref: ticketRef(ticket.number) });
  } catch (err) {
    return serverError(err);
  }
}
