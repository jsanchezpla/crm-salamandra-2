import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { ProjectMember, TeamMember, Project } = tenantModels;
  const { id } = await params;

  const project = await Project.findByPk(id, { attributes: ["id"] });
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const members = await ProjectMember.findAll({
    where: { projectId: id },
    include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "email", "avatarUrl", "position"] }],
    order: [["joinedAt", "ASC"]],
  });
  return ok(members);
});

export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant } = ctx;
  const { ProjectMember, TeamMember, Project } = tenantModels;
  const { id } = await params;

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (!isAdminRole(role) && !(await isLeadOfProject({ projectId: id, userId, tenantModels }))) {
    return forbidden(ADMIN_DENY);
  }

  const project = await Project.findByPk(id);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const body = await request.json();
  const { teamMemberId, role: memberRole } = body;
  if (!teamMemberId) throw new ValidationError("'teamMemberId' es obligatorio");

  const tm = await TeamMember.findByPk(teamMemberId);
  if (!tm) throw new NotFoundError("TeamMember no existe en este tenant");

  const finalRole = ["lead", "member", "viewer"].includes(memberRole) ? memberRole : "member";

  const [member, wasCreated] = await ProjectMember.findOrCreate({
    where: { projectId: id, teamMemberId },
    defaults: { projectId: id, teamMemberId, role: finalRole },
  });
  if (!wasCreated && member.role !== finalRole) {
    await member.update({ role: finalRole });
  }

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "project.member_added",
    entity: "ProjectMember",
    entityId: member.id,
    before: null,
    after: { projectId: id, teamMemberId, role: finalRole },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created(member);
});
