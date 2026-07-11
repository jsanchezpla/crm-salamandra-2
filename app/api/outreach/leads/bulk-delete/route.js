import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría nunca rompe la request.
  }
}

/**
 * POST /api/outreach/leads/bulk-delete — borra varios leads captados a la vez.
 *
 * Body: { ids: [uuid, ...] }. Solo admin (borrar es destructivo). Los contactos
 * y análisis de cada lead caen por ON DELETE CASCADE.
 */
export const POST = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (role !== "admin" && role !== "superadmin") {
    throw new ForbiddenError("Solo un administrador puede borrar leads");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string" && UUID_RE.test(x)) : [];
  if (ids.length === 0) throw new ValidationError("No se han indicado leads válidos");

  const { OutreachLead } = ctx.tenantModels;
  const deleted = await OutreachLead.destroy({ where: { id: { [Op.in]: ids } } });

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.bulk_deleted",
    entity: "OutreachLead",
    entityId: null,
    before: { ids },
    after: { deleted },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ deleted });
});
