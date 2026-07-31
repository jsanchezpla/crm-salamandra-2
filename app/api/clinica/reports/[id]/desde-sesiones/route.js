import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { serializeReport } from "../../../../../../lib/clinica/serialize.js";
import { redactarDesdeSesiones, resumenRedaccion } from "../../../../../../lib/clinica/redactarInforme.js";

/**
 * POST /api/clinica/reports/[id]/desde-sesiones — redacta el borrador del
 * informe con el contenido de las sesiones elegidas (sprint Aumenta 2026-07,
 * punto 3.1).
 *
 * Body: { sessionIds: [uuid, …] } — si no viene, usa las que ya tenía guardadas
 * el informe (`contentSections.sourceSessionIds`).
 *
 * Las sesiones tienen que ser DEL MISMO PACIENTE: componer un informe con
 * sesiones de otro niño sería un incidente de datos de salud, no un error de
 * usabilidad. Y solo cuentan las COMPLETADAS (registradas o publicadas): un
 * borrador a medias no es material para un informe que firma la profesional.
 *
 * No pisa lo que ya esté escrito: rellena lo vacío y añade a las listas lo que
 * falta (ver `lib/clinica/redactarInforme.js`).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADOS_UTILES = ["registered", "published"];

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport, ClinicSession, Patient, TeamMember } = ctx.tenantModels;
    const informe = await ClinicalReport.findByPk(id);
    if (!informe) return notFound("Informe no encontrado");
    if (!ClinicSession) return error("Este cliente no tiene registros de sesión", 503);
    if (informe.status === "delivered") {
      // Reescribir un informe ya entregado dejaría a la familia con un PDF que
      // no coincide con lo que hay en el CRM.
      return error("Este informe ya se envió a la familia: duplícalo o crea uno nuevo para reescribirlo", 409);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      /* sin body: se usan las sesiones ya guardadas */
    }
    const cs = informe.contentSections && typeof informe.contentSections === "object" ? informe.contentSections : {};
    const pedidas = Array.isArray(body?.sessionIds) && body.sessionIds.length
      ? body.sessionIds
      : Array.isArray(cs.sourceSessionIds)
        ? cs.sourceSessionIds
        : [];
    const ids = pedidas.filter((x) => typeof x === "string" && UUID_RE.test(x));
    if (ids.length === 0) return error("Elige al menos una sesión", 422);

    const sesiones = await ClinicSession.findAll({
      where: {
        id: { [Op.in]: ids },
        patientId: informe.patientId,
        status: { [Op.in]: ESTADOS_UTILES },
      },
      order: [["sessionDate", "ASC"]],
    });
    if (sesiones.length === 0) {
      return error("Ninguna de las sesiones elegidas sirve: tienen que ser de este paciente y estar registradas", 422);
    }

    const nuevas = redactarDesdeSesiones(cs, sesiones);
    const aporte = resumenRedaccion(cs, nuevas);
    await informe.update({ contentSections: nuevas });

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.report.drafted",
      entity: "ClinicalReport",
      entityId: id,
      after: { sesiones: sesiones.length, ...aporte },
      ip: request.headers.get("x-forwarded-for"),
    });

    await informe.reload({
      include: [
        { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName", "age", "objectives", "referralReason", "mainTherapistId"] },
        { model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] },
      ],
    });
    return ok({
      ...serializeReport(informe),
      // Cuántas líneas ha traído cada apartado: sin esto, pulsar el botón y ver
      // la pantalla casi igual parece que no ha hecho nada.
      aporte: { sesiones: sesiones.length, descartadas: ids.length - sesiones.length, ...aporte },
    });
  } catch (err) {
    return serverError(err);
  }
});
