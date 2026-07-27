/**
 * Helpers comunes de los Route Handlers del módulo Soporte: settings del
 * tenant (fila única), rol admin y autor efectivo (usuario logueado + su
 * TeamMember, para asignaciones y para firmar los mensajes del hilo).
 */

import { resolveCurrentTeamMemberId } from "../team/currentTeamMember.js";

export const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export function isAdminRequest(request) {
  return ADMIN_ROLES.has(request.headers.get("x-user-role"));
}

/** La fila única de support_settings del tenant (se crea al primer uso). */
export async function getSupportSettings(tenantModels) {
  const { SupportSettings } = tenantModels;
  const [row] = await SupportSettings.findOrCreate({ where: {}, defaults: {} });
  return row;
}

/**
 * Quién firma: userId (master), nombre para mostrar y su TeamMember si lo
 * tiene. El nombre sale del TeamMember (displayName) y si no, del email.
 */
export async function currentAuthor(request, tenantModels) {
  const userId = request.headers.get("x-user-id");
  const email = request.headers.get("x-user-email");
  let teamMemberId = null;
  let name = email || null;
  try {
    teamMemberId = await resolveCurrentTeamMemberId(request, tenantModels);
    if (teamMemberId) {
      const tm = await tenantModels.TeamMember.findByPk(teamMemberId, { attributes: ["id", "displayName"] });
      if (tm?.displayName) name = tm.displayName;
    }
  } catch {
    /* sin TeamMember: firma con el email */
  }
  return { userId, name, teamMemberId };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"];
export const TICKET_PRIORITIES = ["low", "medium", "high", "critical"];
export const ACTIVE_STATUSES = ["open", "in_progress", "waiting"];

/** Include estándar de la bandeja y el detalle. */
export function ticketIncludes(tenantModels) {
  const { Client, Contact, TicketCategory, TeamMember } = tenantModels;
  return [
    { model: Client, as: "client", attributes: ["id", "name", "email"], required: false },
    { model: Contact, as: "contact", attributes: ["id", "name", "email"], required: false },
    { model: TicketCategory, as: "category", attributes: ["id", "name", "color"], required: false },
    { model: TeamMember, as: "assignee", attributes: ["id", "displayName", "userId"], required: false },
  ];
}
