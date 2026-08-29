import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import {
  getTenantGoogleCalendarConfig,
  googleCalendarDisponible,
  origenPeticion,
  redirectUriDe,
  urlAutorizacion,
} from "../../../../../lib/calendar/googleCalendar.js";

/**
 * GET /api/calendar/google/conectar — arranca el OAuth: valida las puertas y
 * redirige a la pantalla de consentimiento de Google. Es una NAVEGACIÓN (el
 * botón hace `location.href`), así que aquí no se responde JSON nunca: los
 * fallos vuelven a /calendario con `?google=error&motivo=…`, que es donde hay
 * una pantalla capaz de explicarlos.
 */
export async function GET(request) {
  const origen = origenPeticion(request);
  const volver = (motivo) =>
    NextResponse.redirect(new URL(`/calendario?google=error&motivo=${motivo}`, origen));

  let ctx;
  try {
    ctx = await getTenantContext(request);
  } catch {
    return NextResponse.redirect(new URL("/login", origen));
  }

  if (!googleCalendarDisponible(ctx)) return volver("modulo");
  // La demo es pública con sesión de admin: guardarle a un visitante anónimo
  // los tokens de SU Google en un tenant público no puede pasar.
  if (isDemoTenant(ctx)) return volver("demo");

  const config = getTenantGoogleCalendarConfig(ctx);
  if (!config.configured) return volver("credenciales");

  const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  if (!teamMemberId) return volver("ficha");

  // `state` anti-CSRF: un valor de un solo uso que viaja a Google y vuelve, y
  // que el callback compara con esta cookie. Sin él, un enlace malicioso podría
  // colarle a alguien una cuenta de Google que no es la suya.
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(
    urlAutorizacion({ clientId: config.clientId, redirectUri: redirectUriDe(origen), state })
  );
  res.cookies.set("gcal_state", state, {
    httpOnly: true,
    sameSite: "lax", // lax y no strict: la vuelta desde Google es cross-site
    secure: origen.startsWith("https"),
    path: "/api/calendar/google",
    maxAge: 600,
  });
  return res;
}
