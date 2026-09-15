import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { veTodoElEquipo } from "../../../../../lib/clinica/coordinadoras.js";

/**
 * POST /api/clinica/entrevistas/no-necesaria — «este paciente no necesita
 * entrevista inicial» (15/09/2026, AV-0141 de Aumenta).
 *
 * Body: `{ patientId, deshacer? }`. Guarda en `patients.entrevista_no_necesaria`
 * quién y cuándo; con `deshacer: true` la quita y la Bandeja vuelve a pedirla.
 * La regla que la lee está en lib/clinica/pendientesClinicos.js.
 *
 * Quién puede: dirección y las coordinadoras (ven la Bandeja de todas), y la
 * profesional que atiende al paciente (le ha dado alguna cita): es a ella a
 * quien se le reclama. Mismo gate que la Bandeja.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("clinica") && !ctx.hasModule("pacientes")) return forbidden("Módulo Clínica no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const { Patient, Booking } = ctx.tenantModels;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const patientId = String(body?.patientId ?? "");
    if (!UUID_RE.test(patientId)) return error("patientId inválido", 422);
    const deshacer = body?.deshacer === true;

    const paciente = await Patient.findByPk(patientId, { attributes: ["id", "entrevistaNoNecesaria"] });
    if (!paciente) return notFound("Paciente no encontrado");

    const miFicha = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const coordina = veTodoElEquipo({ tenant: ctx.tenant, role: ctx.user?.role, teamMemberId: miFicha });
    if (!coordina) {
      const loAtiende = miFicha ? await Booking.count({ where: { patientId, teamMemberId: miFicha } }) : 0;
      if (!loAtiende) return forbidden("Solo quien atiende al paciente, coordinación o dirección");
    }

    const antes = !!paciente.entrevistaNoNecesaria;
    const marca = deshacer
      ? null
      : { at: new Date().toISOString(), byTeamMemberId: miFicha ?? null, byUserId: ctx.user?.id ?? null };
    await paciente.update({ entrevistaNoNecesaria: marca });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: deshacer ? "patient.entrevista.necesaria" : "patient.entrevista.no_necesaria",
      entity: "Patient",
      entityId: patientId,
      before: { noNecesaria: antes },
      after: { noNecesaria: !deshacer },
    });
    return ok({ patientId, entrevistaNoNecesaria: marca });
  } catch (err) {
    return serverError(err);
  }
});
