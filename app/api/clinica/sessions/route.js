import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeSession } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const STATUSES = ["draft", "ai_pending", "registered", "published"];

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicSession, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const where = {};
  if (sp.get("patientId")) where.patientId = sp.get("patientId");
  if (sp.get("therapistId")) where.therapistId = sp.get("therapistId");
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "100", 10) || 100));
  const rows = await ClinicSession.findAll({
    where,
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    order: [["sessionDate", "DESC"]],
    limit,
  });
  return ok({ sessions: rows.map(serializeSession), total: rows.length });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicSession } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.patientId) return error("patientId es obligatorio");
  if (!body?.therapistId) return error("therapistId es obligatorio");
  const obs = body.observations && typeof body.observations === "object" && !Array.isArray(body.observations) ? body.observations : {};
  const payload = {
    patientId: body.patientId,
    therapistId: body.therapistId,
    sessionDate: body.sessionDate ? new Date(body.sessionDate) : new Date(),
    duration: body.duration != null && body.duration !== "" ? Number(body.duration) : null,
    objectives: Array.isArray(body.objectives) ? body.objectives : [],
    activities: body.activities?.trim() || null,
    performance: body.performance?.trim() || null,
    observations: {
      familyComments: obs.familyComments ?? "",
      nextSessionNotes: obs.nextSessionNotes ?? "",
      homeworkTasks: obs.homeworkTasks ?? "",
      incidents: obs.incidents ?? "",
    },
    // Campos del flujo de audio→IA (opcionales): transcripción, estructura cruda,
    // duración del audio y cuándo la IA terminó de procesar.
    aiTranscription: typeof body.aiTranscription === "string" && body.aiTranscription.trim() ? body.aiTranscription.trim() : null,
    aiStructured: body.aiStructured && typeof body.aiStructured === "object" ? body.aiStructured : null,
    audioDurationSec: body.audioDurationSec != null && body.audioDurationSec !== "" ? Number(body.audioDurationSec) : null,
    aiReviewedAt: body.aiReviewedAt ? new Date(body.aiReviewedAt) : null,
    // Registro en 3 partes (sprint Aumenta 2026-07): la preparación previa y la
    // devolución de la familia son OPCIONALES; los adjuntos de preparación
    // llegan aparte (necesitan que la sesión ya exista) por
    // /api/clinica/sessions/[id]/prep-files.
    prepText: typeof body.prepText === "string" && body.prepText.trim() ? body.prepText.trim() : null,
    parentFeedback:
      typeof body.parentFeedback === "string" && body.parentFeedback.trim() ? body.parentFeedback.trim() : null,
    status: STATUSES.includes(body.status) ? body.status : "registered",
    // Cliente/pagador del paciente (foto al crear la sesión).
    clientId: await clientIdOfPatient(ctx.tenantModels, body.patientId),
  };
  const s = await ClinicSession.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.session.created",
    entity: "ClinicSession",
    entityId: s.id,
    after: auditSummary(s),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeSession(s));
});
