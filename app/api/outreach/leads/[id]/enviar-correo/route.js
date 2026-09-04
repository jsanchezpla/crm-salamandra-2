import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";

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
 * POST /api/outreach/leads/:id/enviar-correo
 *
 * Envía el correo modelo de una línea de negocio al contacto elegido.
 *
 * Es correo en frío a una empresa externa: solo se envía con confirmación
 * explícita del comercial, nunca de forma automática. El asunto y el cuerpo
 * llegan editados desde la UI, no se leen de BD, para que lo que se envía sea
 * exactamente lo que la persona ha revisado.
 *
 * `sentAt` se marca ÚNICAMENTE tras un envío real. La clave de Resend es la del
 * TENANT (`lib/outreach/resendConfig.js`, cifrada; sin fallback al `.env`):
 * sin ella se responde 400 antes de intentar nada. Si el tenant guardó la
 * clave literal `dry-run`, `sendEmail` no manda nada al exterior y aquí se
 * devuelve `dryRun: true` sin tocar la BD: marcar el correo como enviado sin
 * haberlo enviado sería mentirle al comercial.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  // Demo pública: el destinatario, asunto y cuerpo vienen en el body, así que
  // con una clave de Resend configurada esto sería un relé de spam abierto.
  assertNotDemoPaidCall(ctx, "El envío de correos");
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachLead, OutreachAnalysis, OutreachBusinessLine } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const { businessLineId, to, subject } = body ?? {};
  const text = body?.body;

  if (!UUID_RE.test(businessLineId ?? "")) throw new ValidationError("Línea de negocio inválida");
  if (!to?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    throw new ValidationError("Destinatario inválido");
  }
  if (!subject?.trim()) throw new ValidationError("El asunto no puede quedar vacío");
  if (!text?.trim()) throw new ValidationError("El cuerpo no puede quedar vacío");

  const lead = await OutreachLead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");

  const line = await OutreachBusinessLine.findByPk(businessLineId);
  if (!line) throw new NotFoundError("Línea de negocio no encontrada");

  const analysis = await OutreachAnalysis.findOne({
    where: { outreachLeadId: lead.id, businessLineId: line.id },
  });
  if (!analysis) throw new ValidationError("Este lead no tiene análisis para esa línea de negocio");

  // Reenviar es posible, pero nunca por accidente.
  if (analysis.sentAt && body?.force !== true) {
    throw new ValidationError(
      `Ya se envió un correo a este lead para ${line.name}. Marca el reenvío explícitamente si es lo que quieres.`
    );
  }

  // Config de Resend del tenant (Configuración → IA/Correo). La key es
  // obligatoria y por-tenant (cifrada); sin ella no se envía.
  const resend = getTenantResendConfig(ctx);
  if (!resend.apiKey) {
    throw new AppError(
      "Configura la clave de Resend en Configuración → Inteligencia Artificial antes de enviar correos.",
      400
    );
  }

  const result = await sendEmail({
    to: to.trim(),
    subject: subject.trim(),
    text,
    from: resend.fromEmail || undefined,
    // Las respuestas del lead caen en un buzón que sí se lee (reply-to),
    // distinto del remitente del outreach (que puede ser un subdominio de envío).
    replyTo: resend.replyTo || undefined,
    apiKey: resend.apiKey, // clave del tenant, descifrada al vuelo
    tags: [{ name: "module", value: "outreach" }],
  });

  if (!result.ok) {
    throw new AppError("No se pudo enviar el correo. Revisa la configuración de email.", 502);
  }

  // Dry-run: no ha salido nada al exterior. No se marca como enviado.
  if (result.dryRun) {
    return ok({
      sent: false,
      dryRun: true,
      message: "Envío simulado (clave de Resend en modo dry-run). No se ha marcado como enviado.",
    });
  }

  await analysis.update({ sentAt: new Date() });

  // Enviar el correo ES contactar: el estado se pone solo para que la lista no
  // diga "Sin contactar" en alguien a quien el CRM acaba de escribir. Solo
  // avanza desde 'new': si ya se descartó a mano, esa decisión manda.
  if (lead.status === "new") {
    await lead.update({ status: "contacted", statusAt: new Date() });
  }

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.email.sent",
    entity: "OutreachAnalysis",
    entityId: analysis.id,
    before: null,
    after: { leadId: lead.id, businessLine: line.key, to: to.trim(), providerId: result.id ?? null },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ sent: true, dryRun: false, sentAt: analysis.sentAt, providerId: result.id ?? null });
});
