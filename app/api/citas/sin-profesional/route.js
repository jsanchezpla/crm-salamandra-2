import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { Op } from "sequelize";

/**
 * Citas SIN profesional asignado, agrupadas por departamento.
 *
 * Sale de la migración de Aumenta (Rodrigo, 02/08/2026): de las 12.030 citas
 * importadas, 1.827 venían a nombre de «NADIE» —el hueco que usa Organízate
 * para las citas sin asignar— o de alguien que ya no está en el centro. Sin una
 * pantalla donde verlas juntas, esas citas se descubrirían de una en una el día
 * que tocaran.
 *
 * ⚠️ NO confundir con la lista de espera de ADMISIÓN (`clients_avanzado`), que
 * es gente esperando plaza. Esto son citas ya reservadas a las que les falta
 * quién las atiende.
 *
 * El departamento NO está guardado: se deduce del tipo de cita («CUOTA LOGOPEDIA
 * 45» → logopedia). Es lo que permite ofrecer solo a las profesionales de esa
 * especialidad al asignar.
 */

const ESPECIALIDADES = [
  [/H\.?H\.?\.?S\.?S|HABILIDADES SOCIALES/i, "habilidades_sociales"],
  [/NEUROPSICOLOG/i, "neuropsicologia"],
  [/LOGOPEDIA|LOGOPEDIC/i, "logopedia"],
  [/PSICOLOG/i, "psicologia"],
  [/PEDAGOG/i, "pedagogia"],
  [/FISIOTERAPIA|FISIO/i, "fisioterapia"],
  [/TERAPIA OCUPACIONAL|T\.\s?OCUPACIONAL/i, "terapia_ocupacional"],
];

function departamentoDe(texto) {
  for (const [re, k] of ESPECIALIDADES) if (re.test(String(texto ?? ""))) return k;
  return null;
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("citas")) return forbidden();

  const { Booking, EventType, Patient } = tenantModels;
  const { searchParams } = new URL(request.url);
  const depto = searchParams.get("departamento");
  // Por defecto solo las que aún no han pasado: reasignar una cita de hace dos
  // años no sirve de nada, y son la mayoría del histórico.
  const incluirPasadas = searchParams.get("incluirPasadas") === "1";

  const where = { teamMemberId: null };
  if (!incluirPasadas) where.scheduledAt = { [Op.gte]: new Date() };

  // El include de `patient` SOLO si el tenant tiene ese módulo y el modelo
  // existe. En tenants de schema parcial —nutri_laura, sin ir más lejos— la
  // tabla `patients` no existe, y unir contra una relación inexistente no
  // devuelve vacío: revienta con 500 y tumba la pantalla entera. Es el mismo
  // cuidado que ya tiene `bookingIncludes` en bookings/[id]/route.js.
  const conPacientes = (hasModule("pacientes") || hasModule("clinica")) && !!Patient;
  const includes = [{ model: EventType, as: "eventType", attributes: ["id", "name"] }];
  if (conPacientes) {
    includes.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] });
  }

  const citas = await Booking.findAll({
    where,
    order: [["scheduledAt", "ASC"]],
    limit: Math.min(parseInt(searchParams.get("limit") ?? "200"), 500),
    include: includes,
  });

  const filas = citas.map((b) => {
    const j = b.toJSON();
    return {
      id: j.id,
      cuando: j.scheduledAt,
      duracion: j.duration,
      paciente: j.patient ? `${j.patient.firstName} ${j.patient.lastName}`.trim() : j.clientName,
      patientId: j.patient?.id ?? null,
      tipo: j.eventType?.name ?? null,
      departamento: departamentoDe(j.eventType?.name ?? j.additionalData),
    };
  });

  const visibles = depto ? filas.filter((f) => f.departamento === depto) : filas;

  // El recuento va sobre TODAS las pendientes, no sobre la página: si no, los
  // contadores de cada departamento mentirían en cuanto haya más de un límite.
  const todas = await Booking.findAll({
    where,
    attributes: ["additionalData"],
    include: [{ model: EventType, as: "eventType", attributes: ["name"] }],
  });
  const porDepto = {};
  for (const b of todas) {
    const k = departamentoDe(b.eventType?.name ?? b.additionalData) ?? "(sin departamento)";
    porDepto[k] = (porDepto[k] ?? 0) + 1;
  }

  return ok({ citas: visibles, total: todas.length, porDepartamento: porDepto });
});

/**
 * Asignar profesional EN BLOQUE. Son 1.827: de una en una es inviable.
 *
 * Body: { bookingIds: [...], teamMemberId }
 */
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("citas")) return forbidden();

  const { Booking, TeamMember } = tenantModels;
  const body = await request.json();

  const ids = Array.isArray(body.bookingIds) ? body.bookingIds.filter(Boolean) : [];
  if (!ids.length) return error("No has elegido ninguna cita", 422);
  if (!body.teamMemberId) return error("Falta la profesional a la que asignarlas", 422);

  const quien = await TeamMember.findByPk(body.teamMemberId);
  if (!quien) return error("Esa profesional no está en la plantilla", 404);

  // Solo se tocan las que SIGUEN sin profesional: si alguien la asignó mientras
  // esta pantalla estaba abierta, no se le pisa el trabajo.
  const [tocadas] = await Booking.update(
    { teamMemberId: body.teamMemberId },
    { where: { id: { [Op.in]: ids }, teamMemberId: null } }
  );

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "citas.asignadas_en_bloque",
    entity: "Booking",
    entityId: null,
    after: { citas: tocadas, teamMemberId: body.teamMemberId },
  });

  return ok({
    asignadas: tocadas,
    pedidas: ids.length,
    // Si no coinciden, alguien se adelantó: mejor decirlo que dejar la pantalla
    // diciendo que se asignaron todas.
    yaTenian: ids.length - tocadas,
  });
});
