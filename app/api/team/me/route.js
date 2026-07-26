import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

// GET /api/team/me — devuelve el TeamMember del usuario logueado (para que cada
// profesional pueda ver/editar SU horario sin ser admin). 404 si el usuario no
// tiene ficha de equipo (p. ej. un admin puro que no da servicio).
// Segmento estático "me": en el App Router gana sobre el dinámico [id].
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("team")) return forbidden("Módulo equipo no activo");
    const { TeamMember } = ctx.tenantModels;
    const id = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!id) return notFound("No tienes ficha de equipo");
    const member = await TeamMember.findByPk(id, {
      attributes: ["id", "displayName", "department", "userId"],
    });
    if (!member) return notFound("No tienes ficha de equipo");
    return ok({ member });
  } catch (err) {
    return serverError(err);
  }
});
