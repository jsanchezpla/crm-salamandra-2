/**
 * lib/team/currentTeamMember.js — quién del equipo es el usuario logueado.
 *
 * Se creó (regla #2) porque el sprint "conectar todo con cliente y equipo"
 * (2026-07-23) necesita, en varios endpoints, saber qué TeamMember corresponde
 * al usuario que hace la petición para poder anotar "esto lo hizo fulano":
 * el nutricionista que crea un plan, quien escribe una nota, quien registra
 * una interacción, quien atiende una solicitud del formulario.
 *
 * El id del usuario llega en la cabecera `x-user-id` (lo inyecta el middleware
 * tras validar el JWT). El vínculo user → team_member es TeamMember.userId.
 *
 * Devuelve el id del TeamMember o null (no todo usuario tiene ficha de equipo,
 * p. ej. un admin que no da servicio). Nunca lanza: un fallo aquí no debe
 * tumbar la operación principal — el enlace es un añadido, no un requisito.
 */
export async function resolveCurrentTeamMemberId(request, tenantModels) {
  try {
    const userId = request.headers.get("x-user-id");
    if (!userId) return null;
    const { TeamMember } = tenantModels;
    if (!TeamMember) return null;
    const tm = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
    return tm ? tm.id : null;
  } catch {
    return null;
  }
}
