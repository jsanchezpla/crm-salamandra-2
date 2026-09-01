import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { asegurarCuotaDeTaller, cerrarCuotaDeTaller } from "../../../../../../lib/clinica/cuotaDeTaller.js";

/**
 * Apuntar y dar de baja a un paciente en un GRUPO de taller.
 *
 * Dar de baja **no borra** la inscripción: le pone fecha de salida. Así queda
 * que el paciente estuvo, que es lo que hace falta para entender su historial
 * dentro de un año.
 *
 * ── DESDE EL 01/09/2026 SE APUNTA A UN GRUPO, NO A LA ACTIVIDAD ─────────────
 * «En los talleres hay que poder poner varios grupos distintos para la misma
 * actividad.» Un niño no va a «habilidades sociales»: va al grupo de los
 * martes, que es el que tiene hora, terapeuta y sitio en la sala. `tallerId` se
 * sigue guardando —es por lo que se pregunta «¿cuántos hacen habilidades
 * sociales?»— y se rellena solo, con el taller del grupo.
 *
 * ── Y APUNTARLO LE DA DE ALTA SU CUOTA ─────────────────────────────────────
 * «Estos pacientes tendrán que estar relacionados entre sí dentro de una misma
 * cuota de talleres. Así se complementan la zona de pago, las citas y los
 * registros de sesiones.» Lo hace `lib/clinica/cuotaDeTaller.js`, y es
 * best-effort: si el taller no tiene concepto de cobro o el centro no tiene
 * Facturación, el niño se apunta igual y la respuesta lo dice.
 */
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerGrupo, TallerInscripcion, Patient } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  if (!body.patientId) return error("Falta el paciente", 422);
  if (!body.grupoId) return error("Falta el grupo: un paciente se apunta a un grupo, no al taller entero", 422);

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");
  if (!taller.active) return error("Ese taller está retirado: reactívalo antes de apuntar a nadie", 409);

  const grupo = await TallerGrupo.findOne({ where: { id: body.grupoId, tallerId: id } });
  if (!grupo) return notFound("Ese grupo no es de este taller");
  if (!grupo.active) return error("Ese grupo está retirado: reactívalo antes de apuntar a nadie", 409);

  const paciente = await Patient.findByPk(body.patientId, { attributes: ["id", "firstName", "lastName"] });
  if (!paciente) return notFound("Paciente no encontrado");

  // Ya apuntado (inscripción abierta en ESE grupo): no es un error para quien
  // lo pulsa, ya está donde quería estar.
  const abierta = await TallerInscripcion.findOne({
    where: { grupoId: grupo.id, patientId: body.patientId, leftAt: null },
  });
  if (abierta) return ok({ yaEstaba: true, inscripcion: abierta });

  const inscripcion = await TallerInscripcion.create({
    tallerId: id,
    grupoId: grupo.id,
    patientId: body.patientId,
    joinedAt: body.joinedAt || new Date().toISOString().slice(0, 10),
    notes: body.notes?.trim() || null,
  });

  // La cuota, después de la inscripción y sin transacción alrededor: apuntar al
  // niño es la operación principal y no puede caerse por Facturación.
  const clientId = await clientIdOfPatient(tenantModels, body.patientId);
  const cuota = await asegurarCuotaDeTaller({
    tenantModels,
    taller,
    grupo,
    patientId: body.patientId,
    clientId,
  });
  if (cuota.cuotaId) await inscripcion.update({ cuotaId: cuota.cuotaId });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.inscrito",
    entity: "TallerInscripcion",
    entityId: inscripcion.id,
    // Sin nombres: la auditoría vive en master, compartida por todos los
    // clientes, y aquí hay datos de menores.
    after: { tallerId: id, grupoId: grupo.id, joinedAt: inscripcion.joinedAt, cuotaCreada: cuota.creada },
  });

  return created({ ...inscripcion.toJSON(), cuota });
});

/** Baja: `?inscripcionId=…`. Le pone fecha de salida y cierra su cuota. */
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

  // Y se le da de baja la cuota del taller. No la borra: le pone fecha de fin,
  // que es como se dan de baja las cuotas en todo el CRM.
  const cuota = await cerrarCuotaDeTaller({ tenantModels, cuotaId: inscripcion.cuotaId });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.baja",
    entity: "TallerInscripcion",
    entityId: inscripcion.id,
    after: { tallerId: id, leftAt: inscripcion.leftAt, cuotaCerrada: cuota.cerrada },
  });

  return ok({ ...inscripcion.toJSON(), cuota });
});
