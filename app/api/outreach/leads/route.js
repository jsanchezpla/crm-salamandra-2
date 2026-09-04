import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isAllowedLeadStatus } from "../../../../lib/outreach/estados.js";

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría nunca rompe la request.
  }
}

/**
 * GET /api/outreach/leads — "Ver ya buscados".
 *
 * Lee SOLO de la base de datos. Nunca dispara scraping ni análisis: eso cuesta
 * tiempo y dinero, y solo ocurre cuando el usuario lo pide explícitamente.
 *
 * Filtros: ?q= &sector= &location= &source= &analyzed=true|false
 *          &status=new|contacted|discarded   (seguimiento manual del comercial)
 *          &minScore=70&line=agencia   (score mínimo en una línea de negocio)
 *          &limit= &offset=
 */
export const GET = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { OutreachLead, OutreachContact, OutreachAnalysis, OutreachBusinessLine } = ctx.tenantModels;

  const sp = new URL(request.url).searchParams;
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  // Los convertidos a cliente NO aparecen en la lista de captados.
  const where = { converted: false };
  const q = sp.get("q")?.trim();
  if (q) where.name = { [Op.iLike]: `%${q}%` };
  for (const field of ["sector", "location", "source"]) {
    const v = sp.get(field)?.trim();
    if (v) where[field] = v;
  }
  const analyzed = sp.get("analyzed");
  if (analyzed === "true" || analyzed === "false") where.analyzed = analyzed === "true";
  // Estado del seguimiento manual. Un valor que no esté en la lista se ignora
  // en vez de dar error: es un filtro de listado, no una escritura.
  const status = sp.get("status")?.trim();
  if (isAllowedLeadStatus(status)) where.status = status;
  const hasEmail = sp.get("hasEmail");
  if (hasEmail === "true") where.email = { [Op.ne]: null };
  else if (hasEmail === "false") where.email = { [Op.is]: null };

  // Filtro por score mínimo en una línea concreta. Se resuelve en dos pasos
  // (IDs primero) porque un `include` con `required` + `limit` haría que el
  // límite se aplicase a las filas del JOIN, no a los leads.
  const minScore = parseInt(sp.get("minScore") ?? "", 10);
  const lineKey = sp.get("line")?.trim();
  if (!Number.isNaN(minScore) && lineKey) {
    const line = await OutreachBusinessLine.findOne({ where: { key: lineKey } });
    if (!line) return ok({ items: [], total: 0, limit, offset });
    const matches = await OutreachAnalysis.findAll({
      attributes: ["outreachLeadId"],
      where: { businessLineId: line.id, score: { [Op.gte]: minScore } },
    });
    const ids = matches.map((m) => m.outreachLeadId);
    if (ids.length === 0) return ok({ items: [], total: 0, limit, offset });
    where.id = { [Op.in]: ids };
  }

  // Orden por columna (whitelist). Secundario por creación para estabilidad.
  const SORTABLE = ["name", "sector", "location", "source", "analyzed", "email", "createdAt"];
  const sortCol = SORTABLE.includes(sp.get("sort")) ? sp.get("sort") : "createdAt";
  const sortDir = (sp.get("dir") ?? "").toUpperCase() === "ASC" ? "ASC" : "DESC";

  const [items, total] = await Promise.all([
    OutreachLead.findAll({
      where,
      include: [
        {
          model: OutreachAnalysis,
          as: "analyses",
          include: [{ model: OutreachBusinessLine, as: "businessLine", attributes: ["id", "key", "name"] }],
        },
        { model: OutreachContact, as: "contacts", attributes: ["id", "isDecisionMaker"] },
      ],
      order: sortCol === "createdAt" ? [["createdAt", sortDir]] : [[sortCol, sortDir], ["createdAt", "DESC"]],
      limit,
      offset,
    }),
    OutreachLead.count({ where }),
  ]);

  return ok({ items: items.map((i) => i.toJSON()), total, limit, offset });
});

/**
 * POST /api/outreach/leads — alta manual de un lead.
 *
 * En Fase 1 es la única vía de entrada (el scraping vía n8n llega en Fase 4).
 * Respeta el índice único (name, location, source) que evita duplicados.
 */
export const POST = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { OutreachLead } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const name = body?.name?.trim();
  if (!name) throw new ValidationError("El nombre de la empresa es obligatorio");

  const existing = await OutreachLead.findOne({
    where: { name, location: body.location ?? null, source: body.source ?? "manual" },
  });
  if (existing) throw new ValidationError("Ya existe un lead con ese nombre, ubicación y fuente");

  const lead = await OutreachLead.create({
    name,
    sector: body.sector ?? null,
    location: body.location ?? null,
    website: body.website ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    source: body.source ?? "manual",
    sourceUrl: body.sourceUrl ?? null,
    rawData: body.rawData ?? {},
    notes: body.notes ?? null,
    analyzed: false,
  });

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.created",
    entity: "OutreachLead",
    entityId: lead.id,
    before: null,
    after: { name: lead.name, source: lead.source },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created(lead.toJSON());
});
