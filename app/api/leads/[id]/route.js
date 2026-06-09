import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../lib/utils/errors.js";
import { ALLOWED_STAGES } from "../../../../lib/leads/stages.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar leads";

async function resolveLead(tenantModels, id) {
  const { Lead } = tenantModels;
  const lead = await Lead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");
  return lead;
}

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  return ok(lead);
});

export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  const body = await request.json();

  const allowed = [
    "name",
    "phone",
    "email",
    "title",
    "stage",
    "probability",
    "value",
    "expectedCloseDate",
    "assignedTo",
    "notes",
    "customFields",
    "clientId",
    "tipo_usuario",
    "motivo",
    "servicio",
    "curso",
    "taller",
    "mensaje",
  ];

  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (updates.stage && !ALLOWED_STAGES.includes(updates.stage)) {
    delete updates.stage;
  }

  if ("email" in updates) updates.email = updates.email?.trim().toLowerCase() || null;

  // Validar clientId: null para desvincular, o UUID que exista en el tenant.
  if ("clientId" in updates) {
    if (updates.clientId === null || updates.clientId === "") {
      updates.clientId = null;
    } else {
      const { Client } = tenantModels;
      const exists = await Client.findByPk(updates.clientId, { attributes: ["id"] });
      if (!exists) delete updates.clientId;
    }
  }

  // Merge customFields en lugar de sobreescribir
  if (updates.customFields) {
    updates.customFields = { ...(lead.customFields ?? {}), ...updates.customFields };
  }

  await lead.update(updates);
  return ok(lead);
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  await lead.destroy();
  return noContent();
});
