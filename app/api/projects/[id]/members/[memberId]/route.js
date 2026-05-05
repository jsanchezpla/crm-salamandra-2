import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}

async function requireEditor(request, projectId, tenantModels) {
  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  if (isAdminRole(role)) return true;
  return isLeadOfProject({ projectId, userId, tenantModels });
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant } = ctx;
  const { ProjectMember } = tenantModels;
  const { id, memberId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const member = await ProjectMember.findOne({ where: { id: memberId, projectId: id } });
  if (!member) throw new NotFoundError("Miembro no encontrado");

  const { role: newRole } = await request.json();
  if (!["lead", "member", "viewer"].includes(newRole)) {
    throw new ValidationError("role debe ser uno de: lead, member, viewer");
  }
  const before = { role: member.role };
  await member.update({ role: newRole });

  await auditLog({
    tenantId: tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "project.member_role_changed",
    entity: "ProjectMember",
    entityId: member.id,
    before,
    after: { role: newRole },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok(member);
});

export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels, tenant } = ctx;
  const { ProjectMember } = tenantModels;
  const { id, memberId } = await params;

  if (!(await requireEditor(request, id, tenantModels))) return forbidden(ADMIN_DENY);

  const member = await ProjectMember.findOne({ where: { id: memberId, projectId: id } });
  if (!member) throw new NotFoundError("Miembro no encontrado");

  const snapshot = { teamMemberId: member.teamMemberId, role: member.role };
  await member.destroy();

  await auditLog({
    tenantId: tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "project.member_removed",
    entity: "ProjectMember",
    entityId: memberId,
    before: snapshot,
    after: null,
    ip: request.headers.get("x-forwarded-for"),
  });

  return noContent();
});
