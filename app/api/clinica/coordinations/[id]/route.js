import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { clientIdOfPatient } from "../../../../../lib/clinica/patientClient.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeCoordination } from "../../../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../../../lib/clinica/audit.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { lineasDelFormulario, asistentesDelFormulario } from "../../../../../lib/clinica/actaCoordinacion.js";
import { contactoValido } from "../../../../../lib/clinica/contactoDelPaciente.js";
import { esDireccion, puedeEditarCoordinacion, motivoParaNoEditar } from "../../../../../lib/clinica/alcanceCoordinaciones.js";

/**
 * Corregir un acta de coordinación (18/09/2026, AV-0102 de Aumenta).
 *
 * «Cuando registras una coordinación no tienes opción a modificarla»: el
 * endpoint de la lista tenía GET y POST y nada más, así que una fecha mal
 * puesta o un acuerdo a medias se quedaba escrito. Quién puede tocarla, con su
 * prueba, en `lib/clinica/alcanceCoordinaciones.js`.
 *
 * No hay DELETE: nadie lo ha pedido, y un acta borrada es una reunión que deja
 * de constar en el expediente. Si un día hace falta, la regla va en el mismo
 * fichero de `lib/` que la de editar.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const TYPES = ["family", "school", "psychiatrist", "neuropediatrician", "other_therapist", "orientator", "other"];
const SCOPES = ["internal", "external"];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { Coordination, TeamMember, Patient } = ctx.tenantModels;
  const c = await Coordination.findByPk(id, {
    include: [
      { model: TeamMember, as: "createdBy", attributes: ["id", "displayName", "position", "avatarColor"] },
      { model: Patient, as: "relatedPatient", attributes: ["id", "firstName", "lastName"], required: false },
    ],
  });
  if (!c) return notFound("Coordinación no encontrada");
  return ok(serializeCoordination(c));
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { Coordination } = ctx.tenantModels;
  const c = await Coordination.findByPk(id);
  if (!c) return notFound("Coordinación no encontrada");

  const esAdmin = esDireccion(ctx.user?.role);
  const yoSoy = esAdmin ? null : await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  if (!puedeEditarCoordinacion({ esAdmin, row: c, teamMemberId: yoSoy })) {
    return forbidden(motivoParaNoEditar({ esAdmin, row: c, teamMemberId: yoSoy }));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if ("coordinationType" in body && !TYPES.includes(body.coordinationType)) return error("coordinationType inválido");

  const updates = {};
  if ("coordinationType" in body) updates.coordinationType = body.coordinationType;
  if ("coordinationDate" in body && body.coordinationDate) updates.coordinationDate = new Date(body.coordinationDate);
  // Mismo troceo que al registrarla: por líneas, y la coma no parte
  // (13/09/2026, lib/clinica/actaCoordinacion.js).
  if ("participants" in body) updates.participants = asistentesDelFormulario(body.participants);
  if ("topics" in body) updates.topics = lineasDelFormulario(body.topics);
  if ("agreements" in body) updates.agreements = lineasDelFormulario(body.agreements);
  if ("nextActions" in body) updates.nextActions = lineasDelFormulario(body.nextActions);
  if ("scope" in body) updates.scope = SCOPES.includes(body.scope) ? body.scope : null;
  if ("externalEntity" in body) {
    updates.externalEntity =
      typeof body.externalEntity === "string" && body.externalEntity.trim()
        ? body.externalEntity.trim().slice(0, 200)
        : null;
  }
  if ("createdByName" in body) {
    updates.createdByName =
      typeof body.createdByName === "string" && body.createdByName.trim()
        ? body.createdByName.trim().slice(0, 200)
        : null;
  }

  // ── El paciente, y lo que cuelga de él ──────────────────────────────────
  // Cambiarlo es el caso que motivó todo esto (un acta registrada en el niño
  // equivocado), y arrastra otras dos cosas: el pagador —que es una foto del
  // paciente— y el contacto de referencia, que pertenece a la agenda de un
  // paciente concreto. Si no se revalidaran, el acta quedaría enlazada con la
  // orientadora de otra familia.
  const pacienteFinal = "relatedPatientId" in body ? body.relatedPatientId || null : c.relatedPatientId;
  const cambiaPaciente = "relatedPatientId" in body && String(pacienteFinal ?? "") !== String(c.relatedPatientId ?? "");
  if (cambiaPaciente) {
    updates.relatedPatientId = pacienteFinal;
    updates.clientId = await clientIdOfPatient(ctx.tenantModels, pacienteFinal);
  }
  if ("externalContactId" in body || cambiaPaciente) {
    const pedido = "externalContactId" in body ? body.externalContactId : c.externalContactId;
    updates.externalContactId = await contactoValido(ctx.tenantModels, pacienteFinal, pedido);
  }
  // Una coordinación interna no tiene con quién de fuera ni contacto externo.
  if (updates.scope === "internal") {
    updates.externalEntity = null;
    updates.externalContactId = null;
  }

  if (Object.keys(updates).length === 0) return ok(serializeCoordination(c));
  const before = auditSummary(c);
  await c.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.coordination.updated",
    entity: "Coordination",
    entityId: id,
    before,
    after: auditSummary(c),
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok(serializeCoordination(c));
});
