import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../lib/utils/errors.js";

const ALLOWED_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];

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

  if (updates.email) updates.email = updates.email.trim().toLowerCase();

  // Merge customFields en lugar de sobreescribir
  if (updates.customFields) {
    updates.customFields = { ...(lead.customFields ?? {}), ...updates.customFields };
  }

  await lead.update(updates);
  return ok(lead);
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads") && !hasModule("sales")) throw new ForbiddenError();
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  await lead.destroy();
  return noContent();
});
