import { slaState } from "./sla.js";

/**
 * Serializers del módulo Soporte: la forma que la API devuelve al frontend y
 * al portal. El portal (público) usa serializePortalTicket, que NO expone
 * notas internas, ids internos de equipo ni emails.
 */

/** "TK-0042" — el número correlativo con el que se habla por teléfono. */
export function ticketRef(number) {
  if (number == null) return "TK-—";
  return `TK-${String(number).padStart(4, "0")}`;
}

export function serializeAttachment(a) {
  const j = a?.toJSON ? a.toJSON() : a;
  return {
    id: j.id,
    messageId: j.messageId ?? null,
    fileName: j.fileName,
    fileSize: j.fileSize ?? 0,
    mimeType: j.mimeType ?? null,
    uploadedByType: j.uploadedByType ?? "team",
    createdAt: j.createdAt ?? null,
  };
}

export function serializeMessage(m) {
  const j = m?.toJSON ? m.toJSON() : m;
  return {
    id: j.id,
    authorType: j.authorType,
    authorUserId: j.authorUserId ?? null,
    authorName: j.authorName ?? null,
    authorEmail: j.authorEmail ?? null,
    body: j.body,
    isInternal: !!j.isInternal,
    emailStatus: j.emailStatus ?? null,
    via: j.via ?? "crm",
    createdAt: j.createdAt ?? null,
    attachments: Array.isArray(j.attachments) ? j.attachments.map(serializeAttachment) : [],
  };
}

/**
 * Ticket para el dashboard. `withThread` añade el hilo completo; la bandeja va
 * sin él (solo cabecera + contadores).
 */
export function serializeTicket(t, { withThread = false } = {}) {
  const j = t?.toJSON ? t.toJSON() : t;
  const out = {
    id: j.id,
    number: j.number ?? null,
    ref: ticketRef(j.number),
    title: j.title,
    description: j.description ?? null,
    status: j.status,
    priority: j.priority,
    channel: j.channel ?? "manual",
    clientId: j.clientId ?? null,
    client: j.client ? { id: j.client.id, name: j.client.name ?? j.client.displayName ?? null } : null,
    contactId: j.contactId ?? null,
    contact: j.contact
      ? { id: j.contact.id, name: j.contact.name ?? null, email: j.contact.email ?? null }
      : null,
    categoryId: j.categoryId ?? null,
    category: j.category ? { id: j.category.id, name: j.category.name, color: j.category.color ?? null } : null,
    assignedTo: j.assignedTo ?? null,
    assignee: j.assignee ? { id: j.assignee.id, displayName: j.assignee.displayName ?? null } : null,
    requesterName: j.requesterName ?? null,
    requesterEmail: j.requesterEmail ?? null,
    portalToken: j.portalToken ?? null,
    firstResponseAt: j.firstResponseAt ?? null,
    resolvedAt: j.resolvedAt ?? null,
    closedAt: j.closedAt ?? null,
    lastMessageAt: j.lastMessageAt ?? j.createdAt ?? null,
    createdAt: j.createdAt ?? null,
    sla: slaState(j),
  };
  if (withThread) {
    out.messages = Array.isArray(j.messages) ? j.messages.map(serializeMessage) : [];
    out.attachments = Array.isArray(j.attachments) ? j.attachments.map(serializeAttachment) : [];
  }
  return out;
}

/**
 * Vista PÚBLICA del ticket (portal, sin login): solo lo que el cliente final
 * debe ver. Sin notas internas, sin ids de equipo, sin due dates del SLA.
 */
export function serializePortalTicket(t, messages = [], attachments = []) {
  const j = t?.toJSON ? t.toJSON() : t;
  const publicMessages = messages
    .map((m) => (m?.toJSON ? m.toJSON() : m))
    .filter((m) => !m.isInternal && m.authorType !== "system")
    .map((m) => ({
      id: m.id,
      from: m.authorType === "client" ? "you" : "team",
      authorName: m.authorType === "client" ? m.authorName : null,
      body: m.body,
      createdAt: m.createdAt ?? null,
    }));
  const publicMessageIds = new Set(publicMessages.map((m) => m.id));
  const publicAttachments = attachments
    .map((a) => (a?.toJSON ? a.toJSON() : a))
    .filter((a) => a.messageId == null || publicMessageIds.has(a.messageId))
    .map((a) => ({
      id: a.id,
      messageId: a.messageId ?? null,
      fileName: a.fileName,
      fileSize: a.fileSize ?? 0,
    }));
  return {
    ref: ticketRef(j.number),
    title: j.title,
    description: j.description ?? null,
    status: j.status,
    createdAt: j.createdAt ?? null,
    resolvedAt: j.resolvedAt ?? null,
    messages: publicMessages,
    attachments: publicAttachments,
  };
}

export function serializeCategory(c) {
  const j = c?.toJSON ? c.toJSON() : c;
  return { id: j.id, name: j.name, color: j.color ?? null, sortOrder: j.sortOrder ?? 0, active: !!j.active };
}

export function serializeTemplate(t) {
  const j = t?.toJSON ? t.toJSON() : t;
  return { id: j.id, name: j.name, body: j.body, sortOrder: j.sortOrder ?? 0, active: !!j.active };
}

export function serializeSettings(s) {
  const j = s?.toJSON ? s.toJSON() : s;
  return {
    slaEnabled: !!j.slaEnabled,
    slaConfig: j.slaConfig ?? {},
    portalEnabled: !!j.portalEnabled,
    portalIntro: j.portalIntro ?? null,
    notifyEmails: Array.isArray(j.notifyEmails) ? j.notifyEmails : [],
    autoClassify: !!j.autoClassify,
    supportEmail: j.supportEmail ?? null,
  };
}
