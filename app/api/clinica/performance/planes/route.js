import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import {
  trimestreConJulio,
  trimestersOf,
  trimesterRange,
  trimesterOf,
  schoolYearOf,
  schoolYearLabel,
} from "../../../../../lib/clinica/trimestres.js";

/**
 * GET /api/clinica/performance/planes?trimestre=N — cumplimiento de los planes
 * de intervención AGREGADO POR TERAPEUTA (sprint Aumenta 2026-07, punto 1.4).
 *
 * El cumplimiento por paciente ya existía (pestaña «Plan» de su ficha), pero
 * para el programa de incentivos hace falta la otra vista: cuántos informes y
 * registros lleva CADA terapeuta de lo que sus planes prometían este trimestre.
 * Sin esto había que abrir las fichas una a una y sumar a mano.
 *
 * Nada se guarda: se cuenta en lectura sobre los informes y las sesiones
 * REALES, igual que el cumplimiento por paciente, así que no puede
 * desincronizarse. Los dos números salen del mismo sitio y no se contradicen.
 *
 * Solo admin: es material del programa de incentivos, como el resto de
 * Desempeño.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  if (!(ctx.hasModule("clinica") || ctx.hasModule("pacientes"))) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección ve el agregado del equipo");
  return null;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { InterventionPlan, Patient, TeamMember, ClinicalReport, ClinicSession } = ctx.tenantModels;
    if (!InterventionPlan) return ok({ trimestre: null, terapeutas: [], aplicable: false });

    const conJulio = trimestreConJulio(ctx.tenant);
    const hoy = new Date();
    const curso = schoolYearOf(hoy);
    const todos = trimestersOf(curso, { conJulio });
    // Por defecto, el trimestre en curso; fuera de trimestre (agosto), el último.
    const actual = trimesterOf(hoy, { conJulio });
    const pedido = new URL(request.url).searchParams.get("trimestre");
    const elegido =
      todos.find((t) => t.key === pedido) ?? todos.find((t) => t.key === actual?.key) ?? todos[todos.length - 1];
    if (!elegido) return error("No hay trimestres definidos para este curso", 422);
    const { start, end } = trimesterRange(elegido);

    const planes = await InterventionPlan.findAll({
      include: [
        {
          model: Patient,
          as: "patient",
          attributes: ["id", "firstName", "lastName", "mainTherapistId", "status"],
          required: true,
        },
      ],
    });
    // Solo pacientes activos: un plan de alguien que ya está de alta no puede
    // seguir contando como trabajo pendiente del terapeuta.
    const vivos = planes.filter((p) => p.patient?.status === "active");
    if (vivos.length === 0) return ok({ trimestre: elegido, curso: schoolYearLabel(curso), terapeutas: [], aplicable: true });

    const patientIds = vivos.map((p) => p.patient.id);
    const enRango = { [Op.gte]: start, [Op.lt]: end };

    const [informes, registros] = await Promise.all([
      ClinicalReport
        ? ClinicalReport.findAll({
            where: { patientId: { [Op.in]: patientIds }, reportDate: enRango },
            attributes: ["patientId"],
          })
        : [],
      ClinicSession
        ? ClinicSession.findAll({
            where: { patientId: { [Op.in]: patientIds }, sessionDate: enRango },
            attributes: ["patientId"],
          })
        : [],
    ]);
    const cuenta = (filas) => {
      const m = new Map();
      for (const f of filas) m.set(String(f.patientId), (m.get(String(f.patientId)) ?? 0) + 1);
      return m;
    };
    const informesPorPaciente = cuenta(informes);
    const registrosPorPaciente = cuenta(registros);

    const equipo = TeamMember
      ? await TeamMember.findAll({ attributes: ["id", "displayName", "position", "avatarColor"] })
      : [];
    const nombres = new Map(equipo.map((t) => [String(t.id), t]));

    const porTerapeuta = new Map();
    for (const plan of vivos) {
      const tid = plan.patient.mainTherapistId ? String(plan.patient.mainTherapistId) : "sin_terapeuta";
      const horario = plan.reportSchedule && typeof plan.reportSchedule === "object" ? plan.reportSchedule : {};
      const pid = String(plan.patient.id);
      const acc =
        porTerapeuta.get(tid) ??
        { pacientes: 0, informesPrevistos: 0, informesHechos: 0, registrosPrevistos: 0, registrosHechos: 0, alDia: 0 };

      // Mismas claves que usa la pestaña «Plan» del paciente.
      const previstosInformes = Number(horario.objectivesReportsPerTrimester) || 0;
      const previstosRegistros = Number(horario.sessionRecordsPerTrimester) || 0;
      const hechosInformes = informesPorPaciente.get(pid) ?? 0;
      const hechosRegistros = registrosPorPaciente.get(pid) ?? 0;

      acc.pacientes++;
      acc.informesPrevistos += previstosInformes;
      acc.informesHechos += hechosInformes;
      acc.registrosPrevistos += previstosRegistros;
      acc.registrosHechos += hechosRegistros;
      if (hechosInformes >= previstosInformes && hechosRegistros >= previstosRegistros) acc.alDia++;
      porTerapeuta.set(tid, acc);
    }

    const terapeutas = [...porTerapeuta.entries()].map(([tid, a]) => {
      const previsto = a.informesPrevistos + a.registrosPrevistos;
      const hecho = Math.min(a.informesHechos, a.informesPrevistos) + Math.min(a.registrosHechos, a.registrosPrevistos);
      const t = nombres.get(tid);
      return {
        therapistId: tid === "sin_terapeuta" ? null : tid,
        name: t?.displayName ?? "Sin terapeuta asignado",
        position: t?.position ?? null,
        color: t?.avatarColor ?? null,
        pacientes: a.pacientes,
        alDia: a.alDia,
        informes: { hechos: a.informesHechos, previstos: a.informesPrevistos },
        registros: { hechos: a.registrosHechos, previstos: a.registrosPrevistos },
        // Se topa cada parte a lo previsto: hacer 20 registros de más no compensa
        // no haber entregado el informe, que es justo lo que mide el incentivo.
        cumplimiento: previsto === 0 ? null : Math.round((hecho / previsto) * 100),
      };
    });
    terapeutas.sort((a, b) => (b.cumplimiento ?? -1) - (a.cumplimiento ?? -1) || a.name.localeCompare(b.name));

    return ok({
      aplicable: true,
      curso: schoolYearLabel(curso),
      trimestre: elegido,
      trimestres: todos,
      terapeutas,
    });
  } catch (err) {
    return serverError(err);
  }
});
