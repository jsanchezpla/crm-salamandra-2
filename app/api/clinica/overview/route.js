import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../../lib/clinica/serialize.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// KPIs de la landing de Clínica, todos computados (nada hardcoded).
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { ClinicSession, ClinicalReport, Coordination, Patient, TeamMember } = ctx.tenantModels;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [sessionsMonth, reportsPending, reportsOverdue, coordinationsTotal, therapistCount, patientsActive, nextReport] =
    await Promise.all([
      ClinicSession.count({ where: { sessionDate: { [Op.gte]: monthStart } } }),
      ClinicalReport.count({ where: { status: { [Op.ne]: "delivered" } } }),
      ClinicalReport.count({ where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: now } } }),
      Coordination.count(),
      TeamMember.count({ where: { status: "active" } }),
      Patient.count({ where: { status: "active" } }),
      ClinicalReport.findOne({
        where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.ne]: null } },
        order: [["dueDate", "ASC"]],
        include: [{ model: Patient, as: "patient", attributes: ["firstName", "lastName"] }],
      }),
    ]);

  // Pacientes recientes: top 6 por fecha de última sesión.
  const lastByPatient = await ClinicSession.findAll({
    attributes: ["patientId", [fn("MAX", col("session_date")), "last"]],
    group: ["patient_id"],
    order: [[fn("MAX", col("session_date")), "DESC"]],
    limit: 6,
    raw: true,
  });
  const recentIds = lastByPatient.map((r) => r.patientId);
  let recentPatients = [];
  if (recentIds.length) {
    const pats = await Patient.findAll({
      where: { id: { [Op.in]: recentIds } },
      include: [{ model: TeamMember, as: "mainTherapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    });
    const lastMap = Object.fromEntries(lastByPatient.map((r) => [r.patientId, r.last]));
    const byId = Object.fromEntries(pats.map((p) => [p.id, p]));
    recentPatients = recentIds
      .map((id) => byId[id])
      .filter(Boolean)
      .map((p) => serializePatient(p, { lastSession: lastMap[p.id] }));
  }

  const nextDelivery = nextReport
    ? {
        dueDate: nextReport.dueDate,
        patientName: nextReport.patient ? `${nextReport.patient.firstName} ${nextReport.patient.lastName}`.trim() : null,
      }
    : null;

  return ok({
    kpis: { sessionsMonth, reportsPending, reportsOverdue, coordinationsTotal, therapistCount, patientsActive, nextDelivery },
    recentPatients,
  });
});
