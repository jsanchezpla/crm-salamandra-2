import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { trimestreConJulio, trimestersOf, trimesterRange, schoolYearOf, schoolYearLabel } from "../../../../../lib/clinica/trimestres.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * /api/pacientes/[id]/plan — Plan de intervención del paciente (sprint 2026-07-29).
 *
 *   GET   → el plan + el CUMPLIMIENTO por trimestre (hechos vs. previstos)
 *   PUT   → crea o actualiza el plan (uno por paciente, 1:1)
 *
 * QUÉ RESUELVE: el motivo de consulta, los objetivos, las metodologías y la
 * información previa vivían dispersos (o no existían). Aquí quedan juntos y
 * desde el principio, que es como los usa una terapeuta al preparar sesión.
 *
 * SECUENCIACIÓN: `reportSchedule` dice cuántos informes de objetivos y cuántos
 * registros de sesión toca POR TRIMESTRE a ESTE paciente (decisión de la
 * reunión del 28/07: va por paciente, no un estándar único del centro). El
 * cumplimiento NO se guarda: se cuenta en lectura sobre los informes y las
 * sesiones reales, así que no puede desincronizarse de la realidad.
 */

const listaDeTextos = (v, max = 40) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, max)
    .map((x) => x.slice(0, 300));

const texto = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/** Entero >= 0, o null si no se indica. Un "0" válido no puede caer a null. */
function entero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 999) return undefined; // inválido
  return n;
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Patient, InterventionPlan, ClinicalReport, ClinicSession } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id", "firstName", "lastName"] });
    if (!paciente) return notFound("Paciente no encontrado");

    const plan = InterventionPlan ? await InterventionPlan.findOne({ where: { patientId: id } }) : null;
    const schedule = plan?.reportSchedule ?? {};
    const previstosInformes = Number(schedule.objectivesReportsPerTrimester) || 0;
    const previstosRegistros = Number(schedule.sessionRecordsPerTrimester) || 0;

    // Cumplimiento del curso escolar EN CURSO, trimestre a trimestre. Se CUENTA
    // sobre los informes y las sesiones reales: no se guarda ningún contador,
    // así que no puede quedarse desfasado respecto a lo que hay de verdad.
    const conJulio = trimestreConJulio(ctx.tenant);
    const curso = schoolYearOf(new Date());
    const trimestres = [];
    for (const t of trimestersOf(curso, { conJulio })) {
      const { start, end } = trimesterRange(t);
      const enRango = { [Op.gte]: start, [Op.lt]: end };
      const [informes, registros] = await Promise.all([
        ClinicalReport
          ? ClinicalReport.count({ where: { patientId: id, reportDate: enRango } })
          : Promise.resolve(0),
        ClinicSession
          ? ClinicSession.count({ where: { patientId: id, sessionDate: enRango } })
          : Promise.resolve(0),
      ]);
      trimestres.push({
        key: t.key,
        label: t.label,
        informes: { hechos: informes, previstos: previstosInformes },
        registros: { hechos: registros, previstos: previstosRegistros },
        // `null` cuando no hay nada previsto: "0 de 0" no es un 100%, es que
        // ese paciente no tiene secuenciación puesta todavía.
        completo:
          previstosInformes === 0 && previstosRegistros === 0
            ? null
            : informes >= previstosInformes && registros >= previstosRegistros,
      });
    }

    return ok({
      patientId: id,
      plan: plan ? plan.toJSON() : null,
      cumplimiento: {
        curso: schoolYearLabel(curso),
        previstos: { informes: previstosInformes, registros: previstosRegistros },
        trimestres,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Patient, InterventionPlan } = ctx.tenantModels;
    if (!InterventionPlan) return error("El plan de intervención no está disponible en este cliente", 503);

    const paciente = await Patient.findByPk(id, { attributes: ["id"] });
    if (!paciente) return notFound("Paciente no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const porTrimestre = entero(body.objectivesReportsPerTrimester);
    const registrosPorTrimestre = entero(body.sessionRecordsPerTrimester);
    if (porTrimestre === undefined || registrosPorTrimestre === undefined) {
      return error("Los informes y registros por trimestre deben ser un número entero entre 0 y 999", 422);
    }

    const valores = {
      patientId: id,
      diagnosis: texto(body.diagnosis, 2000),
      consultationReasons: texto(body.consultationReasons, 4000),
      previousInfo: texto(body.previousInfo, 4000),
      objectives: listaDeTextos(body.objectives),
      activityTypes: listaDeTextos(body.activityTypes),
      methodologies: listaDeTextos(body.methodologies),
      reportSchedule: {
        objectivesReportsPerTrimester: porTrimestre,
        sessionRecordsPerTrimester: registrosPorTrimestre,
      },
    };

    const existente = await InterventionPlan.findOne({ where: { patientId: id } });
    let plan;
    if (existente) {
      plan = await existente.update(valores);
    } else {
      valores.createdById = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
      plan = await InterventionPlan.create(valores);
    }

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: existente ? "pacientes.plan_updated" : "pacientes.plan_created",
      entity: "InterventionPlan",
      entityId: plan.id,
      // Resumen, no el plan entero: el motivo de consulta y el diagnóstico son
      // datos de salud y la auditoría vive en master, compartida por todos.
      after: resumen(plan, ["patientId"]),
    });

    return ok(plan.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
