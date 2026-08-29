import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { encryptSecret } from "../../../../../lib/crypto/secretBox.js";
import {
  NOMBRE_CALENDARIO,
  canjearCodigo,
  crearCalendario,
  emailDeIdToken,
  getTenantGoogleCalendarConfig,
  googleCalendarDisponible,
  origenPeticion,
  redirectUriDe,
} from "../../../../../lib/calendar/googleCalendar.js";
import { sincronizarMiembroConGoogle } from "../../../../../lib/calendar/googleSync.js";

/**
 * GET /api/calendar/google/callback — la vuelta desde la pantalla de
 * consentimiento de Google. Canjea el código, crea el calendario
 * «CRM Salamandra» en la cuenta de la persona, guarda la conexión (tokens
 * cifrados) y le vuelca de golpe los eventos que ya le afectaban.
 *
 * Como /conectar, es una navegación: pase lo que pase se vuelve a /calendario,
 * con `?google=conectado` o con el motivo del fallo.
 */
export async function GET(request) {
  const origen = origenPeticion(request);
  const volver = (motivo) => {
    const res = NextResponse.redirect(
      new URL(motivo ? `/calendario?google=error&motivo=${motivo}` : "/calendario?google=conectado", origen)
    );
    // La cookie del state es de un solo uso, salga bien o mal.
    res.cookies.set("gcal_state", "", { httpOnly: true, path: "/api/calendar/google", maxAge: 0 });
    return res;
  };

  try {
    const ctx = await getTenantContext(request);
    if (!googleCalendarDisponible(ctx)) return volver("modulo");
    if (isDemoTenant(ctx)) return volver("demo");

    const config = getTenantGoogleCalendarConfig(ctx);
    if (!config.configured) return volver("credenciales");

    const url = new URL(request.url);
    // La persona pulsó «Cancelar» en Google: no es un error nuestro, pero hay
    // que decirle algo mejor que una pantalla en blanco.
    if (url.searchParams.get("error")) return volver("rechazado");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = request.cookies.get("gcal_state")?.value;
    if (!code || !state || !cookieState || state !== cookieState) return volver("estado");

    const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!teamMemberId) return volver("ficha");

    const tokens = await canjearCodigo({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: redirectUriDe(origen),
    });
    if (!tokens.ok) return volver("google");

    const { GoogleCalendarConnection } = ctx.tenantModels;
    const previa = await GoogleCalendarConnection.findOne({ where: { teamMemberId } });

    // Con `prompt=consent` Google devuelve refresh_token siempre; si aun así
    // faltara, se conserva el de la conexión previa antes que quedarnos sin él.
    const refreshToken = tokens.refreshToken ?? null;
    if (!refreshToken && !previa) return volver("google");

    /*
     * El calendario se crea SIEMPRE al conectar, también al reconectar: el de
     * la conexión anterior es de la persona (puede haberlo renombrado o
     * borrado) y apuntar a él a ciegas escribiría reuniones en una agenda que
     * ya no controlamos. Editable como pidió Rodrigo: el nombre es suyo desde
     * el primer segundo; nosotros solo guardamos el id.
     */
    const cal = await crearCalendario(tokens.accessToken, NOMBRE_CALENDARIO);
    if (!cal.ok || !cal.json?.id) return volver("google");

    const datos = {
      teamMemberId,
      googleEmail: emailDeIdToken(tokens.idToken) ?? previa?.googleEmail ?? null,
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: refreshToken ? encryptSecret(refreshToken) : previa.refreshToken,
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      calendarId: cal.json.id,
    };
    if (previa) {
      await previa.update(datos);
      // El calendario es nuevo: los ids de eventos del anterior ya no valen.
      await ctx.tenantModels.CalendarTaskAttendee.update({ googleEventId: null }, { where: { teamMemberId } });
    } else {
      await GoogleCalendarConnection.create(datos);
    }

    // Lo que ya estaba en el Calendario y le afecta, de hoy en adelante,
    // aparece en su Google de golpe. Best-effort: si falla, cada evento se
    // empuja en su siguiente guardado.
    await sincronizarMiembroConGoogle({ teamMemberId, ctx });

    return volver(null);
  } catch (err) {
    console.error("[google-calendar] callback", err);
    return volver("interno");
  }
}
