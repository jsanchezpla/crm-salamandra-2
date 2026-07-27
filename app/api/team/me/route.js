import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";

// GET /api/team/me — devuelve la ficha de equipo del usuario logueado (para su
// autoservicio: Mi horario, mini-módulo de Equipo). Gate a nivel de TENANT
// (team o clinica): las terapeutas de un centro NO tienen el módulo `team` en
// su moduleAccess de usuario, pero SÍ tienen ficha y horario — antes esto daba
// 403 y rompía Mi horario (bug 2026-07-27). Solo devuelve datos NO sensibles
// (nada de retribución). Segmento estático "me": gana sobre el dinámico [id].
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const tenantHas = ctx.tenantHasModule ? ctx.tenantHasModule.bind(ctx) : ctx.hasModule.bind(ctx);
    if (!tenantHas("team") && !tenantHas("clinica")) return forbidden("Módulo equipo no activo");
    const { TeamMember } = ctx.tenantModels;
    if (!TeamMember) return notFound("No tienes ficha de equipo");
    const id = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!id) return notFound("No tienes ficha de equipo");
    const member = await TeamMember.findByPk(id, {
      attributes: [
        "id", "displayName", "email", "position", "department", "phone",
        "avatarUrl", "avatarColor", "hiredAt", "status", "userId",
      ],
    });
    if (!member) return notFound("No tienes ficha de equipo");
    return ok({ member });
  } catch (err) {
    return serverError(err);
  }
});
