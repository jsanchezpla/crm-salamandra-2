import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeReport, REPORT_TYPES } from "../../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../../lib/clinica/audit.js";
import { limpiarContentSections } from "../../../../../lib/clinica/plantillas.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { esDireccion, puedeBorrarInforme, motivoParaNoBorrar } from "../../../../../lib/clinica/alcanceInformes.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const TYPES = REPORT_TYPES;
const STATUSES = ["draft", "reviewed", "delivered"];
const PATCH_FIELDS = ["reportType", "reportDate", "dueDate", "contentSections", "status"];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicalReport, Patient, TeamMember } = ctx.tenantModels;
  const r = await ClinicalReport.findByPk(id, {
    include: [
      { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName", "age", "objectives", "referralReason", "mainTherapistId"] },
      { model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] },
    ],
  });
  if (!r) return notFound("Informe no encontrado");
  return ok(serializeReport(r, ctx.tenant));
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicalReport } = ctx.tenantModels;
  const r = await ClinicalReport.findByPk(id);
  if (!r) return notFound("Informe no encontrado");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if ("reportType" in body && !TYPES.includes(body.reportType)) return error("reportType inválido");
  if ("status" in body && !STATUSES.includes(body.status)) return error("status inválido");
  const before = auditSummary(r);
  const updates = {};
  for (const k of PATCH_FIELDS) if (k in body) updates[k] = body[k];
  // Los apartados (título, tipo y orden) los escribe un navegador desde el
  // cajón del informe: se limpian antes de guardarlos (lib/clinica/plantillas.js).
  if ("contentSections" in updates) updates.contentSections = limpiarContentSections(updates.contentSections);
  // Al marcar como entregado, sellar deliveredAt; al revertir, limpiarla.
  if ("status" in updates) {
    if (updates.status === "delivered" && !r.deliveredAt) updates.deliveredAt = new Date();
    if (updates.status !== "delivered") updates.deliveredAt = null;
  }
  if (Object.keys(updates).length === 0) return ok(serializeReport(r, ctx.tenant));
  await r.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.report.updated",
    entity: "ClinicalReport",
    entityId: id,
    before,
    after: auditSummary(r),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializeReport(r, ctx.tenant));
});

/**
 * DELETE /api/clinica/reports/[id] — borrar un informe abierto por error
 * (02/09/2026, AV-0021 de Aumenta). Solo un BORRADOR, y solo quien lo firma o
 * dirección: la regla, con su prueba, en lib/clinica/alcanceInformes.js. Un
 * informe revisado o entregado a una familia no se borra nunca —ni dirección—:
 * ya es un documento que alguien ha leído.
 */
export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { ClinicalReport } = ctx.tenantModels;
  const r = await ClinicalReport.findByPk(id);
  if (!r) return notFound("Informe no encontrado");
  const esAdmin = esDireccion(ctx.user?.role);
  const yoSoy = esAdmin ? null : await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  if (!puedeBorrarInforme({ esAdmin, row: r, teamMemberId: yoSoy })) {
    return forbidden(motivoParaNoBorrar({ esAdmin, row: r, teamMemberId: yoSoy }));
  }
  const before = auditSummary(r);
  await r.destroy();
  // Lo destructivo, en la auditoría: un resumen, nunca la fila entera.
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.report.deleted",
    entity: "ClinicalReport",
    entityId: id,
    before,
    after: null,
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ deleted: id });
});
