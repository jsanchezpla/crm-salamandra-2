import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { isAllowedLeadStatus, LEAD_STATUSES } from "../../../../../lib/outreach/estados.js";
import { MODULE_KEYS } from "../../../../../lib/tenant/moduleKeys.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría nunca rompe la request.
  }
}

function isAdmin(request) {
  const role = request.headers.get("x-user-role");
  return role === "admin" || role === "superadmin";
}

/** Ficha completa del lead: contactos (decisores primero) y análisis por línea. */
export const GET = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachLead, OutreachContact, OutreachAnalysis, OutreachBusinessLine } = ctx.tenantModels;

  const lead = await OutreachLead.findByPk(id, {
    include: [
      { model: OutreachContact, as: "contacts" },
      {
        model: OutreachAnalysis,
        as: "analyses",
        include: [{ model: OutreachBusinessLine, as: "businessLine" }],
      },
    ],
    order: [
      [{ model: OutreachContact, as: "contacts" }, "isDecisionMaker", "DESC"],
      [{ model: OutreachAnalysis, as: "analyses" }, { model: OutreachBusinessLine, as: "businessLine" }, "sortOrder", "ASC"],
    ],
  });
  if (!lead) throw new NotFoundError("Lead no encontrado");

  // Las líneas activas del tenant viajan con la ficha: la UI pinta una columna
  // por línea, incluso para las que este lead aún no tiene analizadas.
  const businessLines = await OutreachBusinessLine.findAll({
    where: { active: true },
    order: [["sortOrder", "ASC"]],
  });

  return ok({
    lead: lead.toJSON(),
    businessLines: businessLines.map((b) => b.toJSON()),
    // Si este tenant tiene archivo de Documentos, el correo puede llevar
    // adjuntos. Lo dice el servidor y no el navegador: es el único que conoce
    // los módulos de verdad, y así el botón no aparece donde no funcionaría.
    puedeAdjuntar: ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO),
  });
});

/** Editar campos propios del lead (no los análisis). */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachLead } = ctx.tenantModels;
  const lead = await OutreachLead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const editable = ["name", "sector", "location", "website", "phone", "email", "notes"];
  const patch = {};
  for (const f of editable) if (f in body) patch[f] = body[f];

  // El estado va aparte: lista blanca (lib/outreach/estados.js) y su fecha, que
  // la pone el servidor. Sin whitelist entraría cualquier string desde el front.
  if ("status" in body) {
    if (!isAllowedLeadStatus(body.status)) {
      throw new ValidationError(`Estado no admitido. Opciones: ${LEAD_STATUSES.join(", ")}`);
    }
    if (body.status !== lead.status) {
      patch.status = body.status;
      patch.statusAt = new Date();
    }
  }

  if (Object.keys(patch).length === 0) throw new ValidationError("Nada que actualizar");
  if ("name" in patch && !patch.name?.trim()) throw new ValidationError("El nombre no puede quedar vacío");

  const before = lead.toJSON();
  await lead.update(patch);

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.updated",
    entity: "OutreachLead",
    entityId: lead.id,
    before,
    after: lead.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok(lead.toJSON());
});

/** Borrar un lead. Sus contactos y análisis caen por ON DELETE CASCADE. */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!isAdmin(request)) throw new ForbiddenError("Solo un administrador puede borrar leads");
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachLead } = ctx.tenantModels;
  const lead = await OutreachLead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");

  const before = lead.toJSON();
  await lead.destroy();

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.deleted",
    entity: "OutreachLead",
    entityId: id,
    before,
    after: null,
    ip: request.headers.get("x-forwarded-for"),
  });

  return noContent();
});
