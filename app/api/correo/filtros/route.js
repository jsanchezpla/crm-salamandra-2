import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { SPECIALTIES } from "../../../../lib/clinica/specialties.js";

/**
 * GET /api/correo/filtros — con qué se puede acotar la lista de destinatarios.
 *
 * Solo tiene contenido en centros con módulo `pacientes` (26/08/2026, Rodrigo:
 * «poder filtrar por profesional y por tipo de terapia»). Devuelve:
 *
 *   profesionales → los miembros del equipo que LLEVAN a algún paciente no dado
 *                   de alta (`Patient.mainTherapistId`). Los demás no salen: un
 *                   filtro que siempre devuelve cero filas es una trampa.
 *   terapias      → las especialidades que el centro USA de verdad (las que
 *                   tiene puesto algún paciente), no la taxonomía entera: en un
 *                   centro sin fisioterapia, «Fisioterapia» en el desplegable
 *                   es ruido.
 *
 * En un tenant sin `pacientes` responde listas vacías y la pantalla no pinta
 * los filtros. No es un error: es que ahí no hay nada por lo que filtrar.
 */
export const GET = withTenant(async (_request, _ctxRuta, ctx) => {
  if (!ctx.hasModule("clients")) throw new ForbiddenError();

  if (!ctx.hasModule("pacientes")) {
    return ok({ profesionales: [], terapias: [] });
  }

  const { Patient, TeamMember } = ctx.tenantModels;

  const pacientes = await Patient.findAll({
    where: { status: { [Op.ne]: "discharged" } },
    attributes: ["mainTherapistId", "specialties"],
  });

  const conPacientes = new Set();
  const enUso = new Set();
  for (const p of pacientes) {
    if (p.mainTherapistId) conPacientes.add(p.mainTherapistId);
    for (const s of Array.isArray(p.specialties) ? p.specialties : []) enUso.add(s);
  }

  const miembros = conPacientes.size
    ? await TeamMember.findAll({
        where: { id: { [Op.in]: [...conPacientes] } },
        attributes: ["id", "displayName"],
        order: [["displayName", "ASC"]],
      })
    : [];

  return ok({
    profesionales: miembros.map((m) => ({ id: m.id, nombre: m.displayName })),
    // En el orden canónico de la taxonomía, no en el del Set.
    terapias: SPECIALTIES.filter((s) => enUso.has(s.key)),
  });
});
