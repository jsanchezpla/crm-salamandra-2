import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";

/**
 * Apuntar y dar de baja a un paciente en un taller.
 *
 * Dar de baja **no borra** la inscripción: le pone fecha de salida. Así queda
 * que el paciente estuvo, que es lo que hace falta para entender su historial
 * dentro de un año.
 */
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerInscripcion, Patient } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  if (!body.patientId) return error("Falta el paciente", 422);

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");
  if (!taller.active) return error("Ese taller está retirado: reactívalo antes de apuntar a nadie", 409);

  const paciente = await Patient.findByPk(body.patientId, { attributes: ["id", "firstName", "lastName"] });
  if (!paciente) return notFound("Paciente no encontrado");

  // Ya apuntado (inscripción abierta): no es un error para quien lo pulsa, ya
  // está donde quería estar.
  const abierta = await TallerInscripcion.findOne({ where: { tallerId: id, patientId: body.patientId, leftAt: null } });
  if (abierta) return ok({ yaEstaba: true, inscripcion: abierta });

  const inscripcion = await TallerInscripcion.create({
    tallerId: id,
    patientId: body.patientId,
    joinedAt: body.joinedAt || new Date().toISOString().slice(0, 10),
    notes: body.notes?.trim() || null,
  });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.inscrito",
    entity: "TallerInscripcion",
    entityId: inscripcion.id,
    // Sin nombres: la auditoría vive en master, compartida por todos los
    // clientes, y aquí hay datos de menores.
    after: { tallerId: id, joinedAt: inscripcion.joinedAt },
  });

  return created(inscripcion);
});

/** Baja: `?inscripcionId=…`. Le pone fecha de salida, no la borra. */
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { TallerInscripcion } = tenantModels;
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const inscripcionId = searchParams.get("inscripcionId");
  if (!inscripcionId) return error("Falta la inscripción", 422);

  const inscripcion = await TallerInscripcion.findOne({ where: { id: inscripcionId, tallerId: id } });
  if (!inscripcion) return notFound("Esa inscripción no es de este taller");
  if (inscripcion.leftAt) return ok({ yaEstabaDeBaja: true, inscripcion });

  await inscripcion.update({ leftAt: new Date().toISOString().slice(0, 10) });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.baja",
    entity: "TallerInscripcion",
    entityId: inscripcion.id,
    after: { tallerId: id, leftAt: inscripcion.leftAt },
  });

  return ok(inscripcion);
});
