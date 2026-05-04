import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, notFound, forbidden } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) return forbidden();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden modificar referidos");

  const { Lead } = tenantModels;
  const { id } = await params;

  // Verificar que el lead existe y es un referido de AbarcaIA
  const lead = await Lead.findOne({
    where: {
      id,
      customFields: { [Op.contains]: { source: "referido_abarcaia" } },
    },
  });

  if (!lead) return notFound("Referido no encontrado");

  const body = await request.json();
  const { stage, notes } = body;

  if (stage !== undefined) lead.stage = stage;
  if (notes !== undefined) lead.notes = notes;

  await lead.save();

  return ok(lead);
});
