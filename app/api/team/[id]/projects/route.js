import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError } from "../../../../../lib/utils/errors.js";
import { serializeProject } from "../../../../../lib/projects/serializeProject.js";
import { isAdminRole, fetchLeadProjectIds } from "../../../../../lib/projects/projectAuth.js";

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Project, ProjectMember, TeamMember } = tenantModels;
  const { id } = await params;

  const member = await TeamMember.findByPk(id, { attributes: ["id"] });
  if (!member) throw new NotFoundError("Miembro del equipo no encontrado");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const leadProjectIds = await fetchLeadProjectIds({ userId, tenantModels });

  const memberships = await ProjectMember.findAll({
    where: { teamMemberId: id },
    attributes: ["projectId", "role"],
    raw: true,
  });
  const projectIds = memberships.map((m) => m.projectId);
  if (projectIds.length === 0) return ok([]);

  const projects = await Project.findAll({
    where: { id: projectIds, archivedAt: null },
    order: [["createdAt", "DESC"]],
  });

  // Anexar el rol del empleado en cada proyecto al payload serializado
  const roleByProject = Object.fromEntries(memberships.map((m) => [m.projectId, m.role]));
  const data = projects.map((p) => {
    const serialized = serializeProject(p, { isAdmin, leadProjectIds });
    return { ...serialized, memberRole: roleByProject[p.id] ?? null };
  });
  return ok(data);
});
