import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";

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
 * `sentAt` se marca ÚNICAMENTE tras un envío real. En dry-run (sin
 * RESEND_API_KEY) se devuelve `dryRun: true` y no se toca la BD: marcar el
 * correo como enviado sin haberlo enviado sería mentirle al comercial.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
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

  const result = await sendEmail({
    to: to.trim(),
    subject: subject.trim(),
    text,
    from: process.env.OUTREACH_FROM_EMAIL || undefined, // si no, el FROM por defecto del CRM
    // Las respuestas del lead caen en un buzón que sí se lee (p.ej. info@),
    // no en el remitente del outreach (que puede ser un subdominio de envío).
    replyTo: process.env.OUTREACH_REPLY_TO || undefined,
    // Credencial propia del módulo si existe; si no, la global del CRM. Así el
    // correo en frío no comparte cuota ni reputación con el resto de emails.
    apiKey: process.env.OUTREACH_RESEND_API_KEY || undefined,
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
      message: "Envío simulado: falta RESEND_API_KEY. No se ha marcado como enviado.",
    });
  }

  await analysis.update({ sentAt: new Date() });

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
