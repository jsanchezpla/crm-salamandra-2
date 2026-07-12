import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { analyzeLead } from "../../../../../../lib/outreach/analysis/index.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";

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
 * POST /api/outreach/leads/:id/analizar
 *
 * Analiza el lead con IA y guarda un análisis por línea de negocio activa.
 * Es la acción de "Analizar" y de "Re-analizar": SIEMPRE explícita. Nada en el
 * CRM llama a este endpoint por su cuenta — cada llamada cuesta dinero.
 *
 * Sobrescribe los análisis previos de ese lead (upsert por línea). Los de
 * líneas que ya no existen se quedan huérfanos y caen por CASCADE al borrar
 * la línea.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { tenantModels, tenantSequelize, tenant } = ctx;
  const { OutreachLead, OutreachAnalysis, OutreachBusinessLine, OutreachSettings } = tenantModels;

  const lead = await OutreachLead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");

  const businessLines = await OutreachBusinessLine.findAll({
    where: { active: true },
    order: [["sortOrder", "ASC"]],
  });
  if (businessLines.length === 0) {
    throw new ValidationError(
      "No hay líneas de negocio activas. Defínelas en la configuración antes de analizar."
    );
  }

  const settings = (await OutreachSettings.findOne()) ?? (await OutreachSettings.create({}));

  let analysis;
  try {
    analysis = await analyzeLead({
      lead: lead.toJSON(),
      businessLines: businessLines.map((b) => b.toJSON()),
      settings: settings.toJSON(),
      companyName: tenant.name,
      // Clave de Anthropic del tenant (Configuración → IA). Fuente ÚNICA del CRM:
      // NO hay fallback a ANTHROPIC_API_KEY del entorno.
      apiKey: getTenantAnthropicKey(ctx) || undefined,
    });
  } catch (err) {
    // Los errores del proveedor no se propagan tal cual: pueden traer trozos
    // del cuerpo de la respuesta de la API. Se traducen a mensajes accionables.
    if (err.code === "NO_API_KEY") {
      throw new AppError("El análisis con IA no está configurado en este entorno", 503);
    }
    if (err.code === "NO_BUSINESS_LINES") {
      throw new ValidationError(err.message);
    }
    console.error("[outreach:analizar]", err);
    throw new AppError("El análisis con IA ha fallado. Inténtalo de nuevo.", 502);
  }

  const analyzedAt = new Date();
  const byKey = new Map(businessLines.map((b) => [b.key, b]));

  await tenantSequelize.transaction(async (transaction) => {
    for (const [key, block] of Object.entries(analysis.results)) {
      const line = byKey.get(key);
      if (!line) continue;

      const existing = await OutreachAnalysis.findOne({
        where: { outreachLeadId: lead.id, businessLineId: line.id },
        transaction,
      });

      const payload = {
        score: block.score,
        reasonWhy: block.reasonWhy,
        needs: block.needs,
        pitch: block.pitch,
        // Re-analizar genera un correo nuevo. Si el anterior ya se envió,
        // se conserva `sentAt` para no perder el rastro del contacto.
        emailDraft: block.emailDraft,
        analyzedAt,
        model: analysis.model,
      };

      if (existing) await existing.update(payload, { transaction });
      else await OutreachAnalysis.create({ ...payload, outreachLeadId: lead.id, businessLineId: line.id }, { transaction });
    }

    await lead.update({ analyzed: true }, { transaction });
  });

  await auditLog({
    tenantId: tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.lead.analyzed",
    entity: "OutreachLead",
    entityId: lead.id,
    before: null,
    after: { model: analysis.model, lines: Object.keys(analysis.results) },
    ip: request.headers.get("x-forwarded-for"),
  });

  const fresh = await OutreachLead.findByPk(lead.id, {
    include: [{ model: OutreachAnalysis, as: "analyses", include: [{ model: OutreachBusinessLine, as: "businessLine" }] }],
  });

  return ok({ lead: fresh.toJSON(), model: analysis.model });
});
