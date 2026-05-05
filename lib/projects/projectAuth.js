/**
 * Helpers de autorización para el módulo Proyectos.
 *
 * Las mutaciones en `Project`, `Phase`, `Milestone`, `BoardColumn` y
 * `ProjectMember` requieren ser admin/superadmin O lead del proyecto.
 * Para chequear "soy lead", el usuario debe tener un `TeamMember` con
 * `userId` igual al `userId` del JWT, y un `ProjectMember(role='lead')`
 * en el proyecto.
 *
 * Caso "admin sin TeamMember": el bypass de admin se aplica primero, así
 * que un admin puede editar cualquier proyecto aunque no tenga perfil de
 * equipo. (Si quiere ser lead operativo y aparecer en la lista de
 * miembros, alguien tiene que crearle el TeamMember en el módulo Equipo.)
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

/**
 * ¿El usuario actual es lead del proyecto?
 *
 * @returns {Promise<boolean>}
 */
export async function isLeadOfProject({ projectId, userId, tenantModels }) {
  if (!userId) return false;
  const { TeamMember, ProjectMember } = tenantModels;

  const member = await TeamMember.findOne({ where: { userId } });
  if (!member) return false;

  const count = await ProjectMember.count({
    where: { projectId, teamMemberId: member.id, role: "lead" },
  });
  return count > 0;
}

/**
 * Resuelve el TeamMember correspondiente al usuario actual, o null si el
 * admin no tiene perfil de equipo.
 */
export async function findOwnTeamMember({ userId, tenantModels }) {
  if (!userId) return null;
  return tenantModels.TeamMember.findOne({ where: { userId } });
}

/**
 * Devuelve el conjunto de projectIds en los que el usuario actual es lead.
 * Útil para precalcular en listados antes de serializar.
 *
 * @returns {Promise<Set<string>>}
 */
export async function fetchLeadProjectIds({ userId, tenantModels }) {
  if (!userId) return new Set();
  const member = await tenantModels.TeamMember.findOne({ where: { userId } });
  if (!member) return new Set();
  const rows = await tenantModels.ProjectMember.findAll({
    where: { teamMemberId: member.id, role: "lead" },
    attributes: ["projectId"],
    raw: true,
  });
  return new Set(rows.map((r) => r.projectId));
}

/**
 * Comprueba si el usuario puede editar el proyecto (admin O lead).
 */
export async function canEditProject({ projectId, role, userId, tenantModels }) {
  if (isAdminRole(role)) return true;
  return isLeadOfProject({ projectId, userId, tenantModels });
}
