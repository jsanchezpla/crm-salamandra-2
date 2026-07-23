import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeReport } from "../../../../lib/clinica/serialize.js";
import { logClinicaAudit } from "../../../../lib/clinica/audit.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const TYPES = ["evolution", "admission", "discharge"];
const STATUSES = ["draft", "reviewed", "delivered"];

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicalReport, Patient, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;
  const where = {};
  if (sp.get("patientId")) where.patientId = sp.get("patientId");
  if (sp.get("therapistId")) where.therapistId = sp.get("therapistId");
  const status = sp.get("status");
  if (status && STATUSES.includes(status)) where.status = status;
  const rows = await ClinicalReport.findAll({
    where,
    include: [
      { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName", "age", "objectives", "referralReason", "mainTherapistId"] },
      { model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] },
    ],
    order: [["reportDate", "DESC"]],
    limit: 300,
  });
  return ok({ reports: rows.map(serializeReport), total: rows.length });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicalReport } = ctx.tenantModels;
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.patientId) return error("patientId es obligatorio");
  if (!body?.therapistId) return error("therapistId es obligatorio");
  const cs = body.contentSections && typeof body.contentSections === "object" && !Array.isArray(body.contentSections) ? body.contentSections : {};
  const payload = {
    patientId: body.patientId,
    therapistId: body.therapistId,
    reportType: TYPES.includes(body.reportType) ? body.reportType : "evolution",
    reportDate: body.reportDate || new Date().toISOString().slice(0, 10),
    dueDate: body.dueDate || null,
    contentSections: cs,
    status: STATUSES.includes(body.status) ? body.status : "draft",
    // Cliente/pagador del paciente (foto al crear el informe).
    clientId: await clientIdOfPatient(ctx.tenantModels, body.patientId),
  };
  const r = await ClinicalReport.create(payload);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.report.created",
    entity: "ClinicalReport",
    entityId: r.id,
    after: r.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeReport(r));
});
