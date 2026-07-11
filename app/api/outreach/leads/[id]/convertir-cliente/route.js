import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría nunca rompe la request.
  }
}

/**
 * POST /api/outreach/leads/:id/convertir-cliente
 *
 * Crea un Client (módulo Clientes) a partir del lead captado y MARCA el lead
 * como convertido (no lo borra). Efecto:
 *   · desaparece de la lista de captados,
 *   · "Buscar nuevos" no lo vuelve a insertar (ya es cliente).
 *
 * Requiere que el tenant tenga el módulo `clients` activo.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!ctx.tenantHasModule("clients")) {
    throw new AppError("El módulo de Clientes no está activo para este tenant.", 400);
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachLead, Client } = ctx.tenantModels;
  const lead = await OutreachLead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");
  if (lead.converted) {
    return ok({ alreadyConverted: true, clientId: lead.clientId });
  }

  // Solo pasamos email si es válido: el modelo Client valida isEmail y un correo
  // scrapeado raro haría fallar el alta.
  const email = lead.email && EMAIL_RE.test(lead.email) ? lead.email.toLowerCase() : null;

  const client = await Client.create({
    name: lead.name,
    type: "company",
    email,
    phone: lead.phone ?? null,
    notes: lead.notes ?? null,
    customFields: {
      origin: "outreach",
      website: lead.website ?? null,
      sector: lead.sector ?? null,
      city: lead.location ?? null,
      sourceUrl: lead.sourceUrl ?? null,
      outreachLeadId: lead.id,
    },
  });

  await lead.update({ converted: true, convertedAt: new Date(), clientId: client.id });

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.converted",
    entity: "OutreachLead",
    entityId: lead.id,
    before: null,
    after: { clientId: client.id, name: client.name },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ converted: true, clientId: client.id, clientName: client.name });
});
