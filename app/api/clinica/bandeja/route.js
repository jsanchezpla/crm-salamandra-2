import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { REPORT_TYPE_LABEL } from "../../../../lib/clinica/serialize.js";
import { categoryLabel, statusLabel, priorityLabel, INCIDENCIA_STATUS } from "../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const patientName = (p) => (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : null);
const isoDate = (d) => (d ? (typeof d === "string" ? d : new Date(d).toISOString()).slice(0, 10) : null);

/**
 * GET /api/clinica/bandeja — "lo mío pendiente" del terapeuta logueado:
 * informes sin entregar, incidencias asignadas sin resolver y citas de hoy.
 * Admin puede ver la de otro con ?therapistId=. Si el usuario no tiene ficha de
 * equipo, cae al primer terapeuta activo (igual que "Mi desempeño").
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const M = ctx.tenantModels;
  const { ClinicalReport, Incidencia, Booking, TeamMember, Patient, EventType } = M;
  const sp = new URL(request.url).searchParams;

  let therapistId = await resolveCurrentTeamMemberId(request, M);
  const asked = sp.get("therapistId");
  if (!therapistId && asked && UUID_RE.test(asked)) therapistId = asked;
  if (!therapistId) {
    const first = await TeamMember.findOne({ where: { status: "active" }, order: [["createdAt", "ASC"]], attributes: ["id"] });
    therapistId = first?.id ?? null;
  }
  const therapist = therapistId ? await TeamMember.findByPk(therapistId, { attributes: ["id", "displayName", "position", "avatarColor"] }) : null;
  if (!therapist) return ok({ therapist: null, reports: [], incidencias: [], citasToday: [], counts: { reports: 0, reportsOverdue: 0, incidencias: 0, citasToday: 0 } });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // ── Informes pendientes (no entregados) ──
  const reportRows = await ClinicalReport.findAll({
    where: { therapistId, status: { [Op.ne]: "delivered" } },
    include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false }],
    order: [["dueDate", "ASC"], ["reportDate", "ASC"]],
    limit: 100,
  });
  const reports = reportRows.map((r) => {
    const j = r.toJSON();
    const overdue = j.dueDate ? isoDate(j.dueDate) < todayStr : false;
    return {
      id: j.id,
      patientId: j.patientId,
      patientName: patientName(j.patient),
      type: j.reportType,
      typeLabel: REPORT_TYPE_LABEL[j.reportType] ?? j.reportType,
      status: j.status,
      dueDate: isoDate(j.dueDate),
      overdue,
    };
  });
  const reportsOverdue = reports.filter((r) => r.overdue).length;

  // ── Incidencias asignadas sin resolver ──
  const incRows = await Incidencia.findAll({
    where: { assignedToId: therapistId, status: { [Op.ne]: "resolved" } },
    include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false }],
    order: [["incidenceDate", "DESC"]],
    limit: 100,
  });
  const incidencias = incRows.map((r) => {
    const j = r.toJSON();
    return {
      id: j.id,
      title: j.title,
      category: j.category,
      categoryLabel: categoryLabel(j.category),
      status: j.status,
      statusLabel: statusLabel(j.status),
      statusLevel: INCIDENCIA_STATUS[j.status]?.level ?? "gray",
      priority: j.priority,
      priorityLabel: priorityLabel(j.priority),
      patientName: patientName(j.patient),
      date: isoDate(j.incidenceDate),
    };
  });

  // ── Citas de hoy ──
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const bookingRows = await Booking.findAll({
    where: {
      teamMemberId: therapistId,
      status: { [Op.in]: ["pending", "confirmed", "completed"] },
      scheduledAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
    },
    include: [
      { model: EventType, as: "eventType", attributes: ["id", "name"], required: false },
      { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
    ],
    order: [["scheduledAt", "ASC"]],
    limit: 100,
  });
  const citasToday = bookingRows.map((b) => {
    const j = b.toJSON();
    return {
      id: j.id,
      // ISO crudo: la hora se formatea en el cliente (zona del navegador),
      // no en el servidor (que puede estar en UTC).
      scheduledAt: j.scheduledAt,
      clientName: j.clientName,
      patientName: patientName(j.patient),
      eventType: j.eventType?.name ?? null,
      duration: j.duration,
      modality: j.modality,
      status: j.status,
    };
  });

  const therapists = (
    await TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"], order: [["displayName", "ASC"]] })
  ).map((t) => ({ id: t.id, name: t.displayName }));

  return ok({
    therapist: { id: therapist.id, name: therapist.displayName, position: therapist.position ?? "", color: therapist.avatarColor ?? "#1B3A2D" },
    therapists,
    reports,
    incidencias,
    citasToday,
    counts: { reports: reports.length, reportsOverdue, incidencias: incidencias.length, citasToday: citasToday.length },
  });
});
