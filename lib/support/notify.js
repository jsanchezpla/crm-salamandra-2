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
import { isDemoTenant } from "../demo/isDemo.js";
import { ticketRef } from "./serialize.js";

/**
 * Dirección de CAPTURA de correo del tenant: todo lo que llegue ahí lo procesa
 * el webhook inbound y cae en el hilo del ticket que corresponda (o abre uno
 * nuevo). Requiere RESEND_INBOUND_DOMAIN (dominio inbound verificado en
 * Resend, con el webhook apuntando a /api/webhooks/resend-inbound). Sin la
 * env, no hay captura: se devuelve null y los emails salen sin reply-to
 * especial (el portal sigue cubriendo la respuesta del cliente).
 */
export function captureAddress(slug) {
  const domain = (process.env.RESEND_INBOUND_DOMAIN || "").trim();
  if (!domain || !slug) return null;
  return `soporte-${slug}@${domain}`;
}

/**
 * Reply-To de los emails al cliente: el correo de soporte PROPIO del tenant si
 * lo configuró (la conversación sigue en SU buzón — Outlook, Gmail... — y el
 * CRM la captura vía el reenvío que ese buzón hace a captureAddress); si no,
 * la dirección de captura directa (la respuesta cae directa en el CRM).
 */
export function replyToAddress(slug, settings) {
  const propio = String(settings?.supportEmail || "").trim();
  return propio || captureAddress(slug);
}

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
 *
 * `settings` (support_settings del tenant) es opcional: si no viene, se carga
 * aquí — decide el reply-to (correo propio del tenant o captura del CRM).
 * Desde la DEMO nunca se envía (mismo criterio que assertNotDemoPaidCall: la
 * demo da admin a anónimos y el destinatario va en datos del tenant).
 */
export async function emailClient({ ctx, ticket, kind, replyBody, baseUrl, settings = null }) {
  const to = resolveClientEmail(ticket);
  if (!to) return "skipped";
  if (isDemoTenant(ctx)) return "skipped";
  let cfg = settings;
  if (!cfg) {
    try {
      const { SupportSettings } = ctx.tenantModels;
      [cfg] = await SupportSettings.findOrCreate({ where: {}, defaults: {} });
    } catch {
      cfg = null;
    }
  }
  const j = ticket?.toJSON ? ticket.toJSON() : ticket;
  const replyTo = replyToAddress(ctx.slug, cfg);
  const tpl = ticketClientTemplate({
    tenantName: ctx.tenant.name,
    brand: ctx.tenant.settings?.brand || {},
    kind,
    ticketRef: ticketRef(j.number),
    title: j.title,
    replyBody: replyBody ?? null,
    portalUrl: portalTicketUrl(baseUrl, ctx.slug, j.portalToken),
    canReplyByEmail: !!replyTo,
  });
  const res = await sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    replyTo: replyTo || undefined,
  });
  return res.ok ? "sent" : "failed";
}

/** Email interno (new_portal | assigned | client_reply) a una lista de correos. */
export async function emailTeam({ ctx, ticket, kind, to, preview, baseUrl }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;
  if (isDemoTenant(ctx)) return; // la demo no envía correo real
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

/**
 * Aviso completo al equipo de que EL CLIENTE HA HABLADO (por el portal o por
 * correo): campana + email al asignado; sin asignado, campana a los admins.
 * Compartido por el POST público del portal y el webhook de correo entrante.
 */
export async function notifyTeamOfClientReply({ ctx, ticket, preview, baseUrl }) {
  try {
    const j = ticket?.toJSON ? ticket.toJSON() : ticket;
    if (j.assignedTo) {
      const assignee = await ctx.tenantModels.TeamMember.findByPk(j.assignedTo).catch(() => null);
      const user = assignee ? await teamMemberUser(assignee) : null;
      if (user?.id) {
        await notifyUser({
          tenantModels: ctx.tenantModels,
          userId: user.id,
          type: "ticket_reply",
          title: "El cliente ha respondido",
          body: `${ticketRef(j.number)} · ${j.title}`,
          ticketId: j.id,
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
        body: `${ticketRef(j.number)} · ${j.title}`,
        ticketId: j.id,
      });
    }
  } catch {
    /* best-effort */
  }
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
