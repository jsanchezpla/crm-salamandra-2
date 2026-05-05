import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError } from "../../../../../lib/utils/errors.js";
import { serializeProject } from "../../../../../lib/projects/serializeProject.js";
import { isAdminRole, fetchLeadProjectIds } from "../../../../../lib/projects/projectAuth.js";

export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("projects")) throw new ForbiddenError();
  const { tenantModels } = ctx;
  const { Project, Client } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id, { attributes: ["id"] });
  if (!client) throw new NotFoundError("Cliente no encontrado");

  const role = request.headers.get("x-user-role");
  const userId = request.headers.get("x-user-id");
  const isAdmin = isAdminRole(role);
  const leadProjectIds = await fetchLeadProjectIds({ userId, tenantModels });

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";
  const where = { clientId: id };
  if (!includeArchived) where.archivedAt = null;

  const projects = await Project.findAll({
    where,
    order: [["createdAt", "DESC"]],
  });

  return ok(projects.map((p) => serializeProject(p, { isAdmin, leadProjectIds })));
});
