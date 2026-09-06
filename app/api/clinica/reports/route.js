import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../lib/clinica/patientClient.js";
import { ok, created, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializeReport, REPORT_TYPES, REPORT_TYPES_NUEVOS } from "../../../../lib/clinica/serialize.js";
import { CLAVE_PLANTILLA } from "../../../../lib/clinica/plantillas.js";
import { TIPO_DIAGNOSTICO } from "../../../../lib/clinica/pruebasDiagnosticas.js";
import { logClinicaAudit, auditSummary } from "../../../../lib/clinica/audit.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
// Fuente única de tipos (lib/clinica/serialize.js): antes esta lista vivía
// duplicada aquí y en otros cuatro sitios, y añadir "Derivación" al sprint
// habría dejado el tipo válido en unos y rechazado en otros.
const TYPES = REPORT_TYPES;
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
  return ok({ reports: rows.map((fila) => serializeReport(fila, ctx.tenant)), total: rows.length });
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
  // La entrevista inicial NO es un informe (03/09/2026, Rodrigo): es un
  // registro de sesión con su plantilla de 15 apartados. Se rechaza con el
  // motivo en vez de convertirla en silencio a «evolutivo», que es lo que
  // haría el respaldo de abajo. Los informes `admission` que ya existen se
  // siguen leyendo y editando (REPORT_TYPES, en el PATCH).
  if (body.reportType === "admission") {
    return error(
      "La entrevista inicial no es un informe: se escribe como registro de sesión desde la ficha del paciente («Nuevo registro», plantilla «Entrevista inicial») o desde su cita de valoración inicial.",
      422
    );
  }
  const cs = body.contentSections && typeof body.contentSections === "object" && !Array.isArray(body.contentSections) ? body.contentSections : {};
  // El informe de valoración diagnóstica nace con SU plantilla puesta
  // (05/09/2026, AV-0045): si no, se abriría con los siete apartados de
  // siempre y habría que ir a buscarla en el desplegable.
  if (body.reportType === TIPO_DIAGNOSTICO && !cs[CLAVE_PLANTILLA]) cs[CLAVE_PLANTILLA] = TIPO_DIAGNOSTICO;
  const payload = {
    patientId: body.patientId,
    therapistId: body.therapistId,
    reportType: REPORT_TYPES_NUEVOS.includes(body.reportType) ? body.reportType : "evolution",
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
    after: auditSummary(r),
    ip: request.headers.get("x-forwarded-for"),
  });
  return created(serializeReport(r, ctx.tenant));
});
