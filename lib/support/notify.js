/**
 * Avisos del módulo Soporte: campana interna (tabla notifications) y emails
 * (Resend). Todo best-effort: un aviso que falla JAMÁS tumba la operación que
 * lo disparó (crear ticket, responder...). Los callers llaman y siguen.
 *
 * Destinatario del email al cliente final, en este orden:
 *   ticket.requesterEmail (foto del alta) → contact.email → client.email
 */

import { sendEmail } from "../email/resendClient.js";
import { ticketClientTemplate } from "../email/templates/soporte/ticketClient.js";
import { ticketTeamTemplate } from "../email/templates/soporte/ticketTeam.js";
import { getMasterModels } from "../db/masterDb.js";
import { ticketRef } from "./serialize.js";

/**
 * Base pública de la app para construir enlaces absolutos en emails. Detrás
 * del nginx de producción la request llega con x-forwarded-*; en local vale el
 * origin de la propia URL.
 */
export function requestBaseUrl(request) {
  try {
    const proto = request.headers.get("x-forwarded-proto");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (host) return `${proto || "https"}://${host}`;
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export function portalTicketUrl(baseUrl, slug, token) {
  if (!baseUrl || !token) return null;
  return `${baseUrl}/widget/c/${slug}/soporte/t/${token}`;
}

export function dashboardTicketUrl(baseUrl, ticketId) {
  if (!baseUrl) return null;
  return `${baseUrl}/soporte?ticket=${ticketId}`;
}

/** Email efectivo del cliente final de un ticket (o null si no hay ninguno). */
export function resolveClientEmail(ticket) {
  const j = ticket?.toJSON ? ticket.toJSON() : ticket;
  return j.requesterEmail || j.contact?.email || j.client?.email || null;
}

/** Campana: notificación directa a UN usuario del CRM. Silenciosa si falla. */
export async function notifyUser({ tenantModels, userId, type, title, body, ticketId }) {
  try {
    const { Notification } = tenantModels;
    if (!Notification || !userId) return;
    await Notification.create({
      userId,
      channel: "app",
      type,
      title,
      body: body ?? null,
      entityType: "Ticket",
      entityId: ticketId,
      read: false,
    });
  } catch {
    /* la campana es un añadido */
  }
}

/** Campana a todos los admins del tenant (para tickets nuevos del portal). */
export async function notifyTenantAdmins({ ctx, type, title, body, ticketId }) {
  try {
    const { User } = getMasterModels();
    const admins = await User.findAll({
      where: { tenantId: ctx.tenant.id, role: ["admin", "superadmin"] },
      attributes: ["id"],
    });
    for (const a of admins) {
      await notifyUser({ tenantModels: ctx.tenantModels, userId: a.id, type, title, body, ticketId });
    }
  } catch {
    /* silencioso */
  }
}

/** Email del User master detrás de un TeamMember (o null). */
export async function teamMemberUser(teamMember) {
  try {
    if (!teamMember?.userId) return null;
    const { User } = getMasterModels();
    const u = await User.findByPk(teamMember.userId, { attributes: ["id", "email"] });
    return u ? { id: u.id, email: u.email } : null;
  } catch {
    return null;
  }
}

/**
 * Email al CLIENTE final (created | reply | resolved). Devuelve
 * "sent" | "failed" | "skipped" para dejarlo anotado en el mensaje.
 */
export async function emailClient({ ctx, ticket, kind, replyBody, baseUrl }) {
  const to = resolveClientEmail(ticket);
  if (!to) return "skipped";
  const j = ticket?.toJSON ? ticket.toJSON() : ticket;
  const tpl = ticketClientTemplate({
    tenantName: ctx.tenant.name,
    brand: ctx.tenant.settings?.brand || {},
    kind,
    ticketRef: ticketRef(j.number),
    title: j.title,
    replyBody: replyBody ?? null,
    portalUrl: portalTicketUrl(baseUrl, ctx.slug, j.portalToken),
  });
  const res = await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  return res.ok ? "sent" : "failed";
}

/** Email interno (new_portal | assigned | client_reply) a una lista de correos. */
export async function emailTeam({ ctx, ticket, kind, to, preview, baseUrl }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;
  const j = ticket?.toJSON ? ticket.toJSON() : ticket;
  const tpl = ticketTeamTemplate({
    tenantName: ctx.tenant.name,
    brand: ctx.tenant.settings?.brand || {},
    kind,
    ticketRef: ticketRef(j.number),
    title: j.title,
    requester: j.requesterName || j.client?.name || null,
    preview: preview ?? null,
    dashboardUrl: dashboardTicketUrl(baseUrl, j.id),
  });
  await sendEmail({ to: recipients, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

/** Aviso completo de asignación: campana + email al TeamMember responsable. */
export async function notifyAssignment({ ctx, ticket, assignee, baseUrl }) {
  if (!assignee) return;
  const user = await teamMemberUser(assignee);
  const j = ticket?.toJSON ? ticket.toJSON() : ticket;
  if (user?.id) {
    await notifyUser({
      tenantModels: ctx.tenantModels,
      userId: user.id,
      type: "ticket_assigned",
      title: "Ticket asignado a ti",
      body: `${ticketRef(j.number)} · ${j.title}`,
      ticketId: j.id,
    });
  }
  if (user?.email) {
    await emailTeam({ ctx, ticket, kind: "assigned", to: user.email, preview: j.description, baseUrl });
  }
}
