import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { decryptSecret } from "../../../../lib/crypto/secretBox.js";
import {
  getTenantGoogleCalendarConfig,
  googleCalendarDisponible,
  revocarToken,
} from "../../../../lib/calendar/googleCalendar.js";

/**
 * /api/calendar/google — el estado de MI conexión con Google Calendar, y el
 * botón de desconectar. La de conectar vive en ./conectar (es una redirección
 * a Google, no un JSON).
 */

export const GET = withTenant(async (request, _routeContext, ctx) => {
  const disponible = googleCalendarDisponible(ctx);
  const configurado = getTenantGoogleCalendarConfig(ctx).configured;

  let conectado = false;
  let googleEmail = null;
  let sinFicha = false;

  if (disponible) {
    const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!teamMemberId) {
      // Un admin sin ficha de equipo no tiene calendario que conectar: la
      // pantalla lo dice en vez de mandarle a un OAuth que acabaría en error.
      sinFicha = true;
    } else {
      const conexion = await ctx.tenantModels.GoogleCalendarConnection.findOne({
        where: { teamMemberId },
        attributes: ["id", "googleEmail"],
      }).catch(() => null); // sin la tabla (migración pendiente) = sin conexión
      if (conexion) {
        conectado = true;
        googleEmail = conexion.googleEmail;
      }
    }
  }

  return ok({ disponible, configurado, conectado, googleEmail, sinFicha });
});

export const DELETE = withTenant(async (request, _routeContext, ctx) => {
  if (!googleCalendarDisponible(ctx)) return forbidden();

  const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  if (!teamMemberId) return noContent(); // sin ficha no hay nada que desconectar

  const { GoogleCalendarConnection, CalendarTaskAttendee } = ctx.tenantModels;
  const conexion = await GoogleCalendarConnection.findOne({ where: { teamMemberId } });
  if (!conexion) return noContent(); // ya estaba desconectado: mismo resultado

  // Best-effort: que Google sepa que el permiso sobra. Si no llega, caduca solo.
  try {
    await revocarToken(decryptSecret(conexion.refreshToken));
  } catch {
    /* clave de cifrado rotada: no hay token que revocar */
  }

  /*
   * El calendario «CRM Salamandra» y sus eventos SE QUEDAN en su Google: son
   * suyos, y borrarle una agenda a alguien al desconectar sería una sorpresa
   * fea. Lo que se corta es la sincronización — y se limpian los ids remotos,
   * para que una reconexión (que crea calendario nuevo) empiece de cero en vez
   * de apuntar a eventos de un calendario viejo.
   */
  await CalendarTaskAttendee.update({ googleEventId: null }, { where: { teamMemberId } });
  await conexion.destroy();

  return noContent();
});
