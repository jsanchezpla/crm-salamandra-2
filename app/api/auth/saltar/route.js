import { NextResponse } from "next/server";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";
import { esPeticionDeBackoffice, esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { auditarLogin } from "../../../../lib/auth/loginGuard.js";
import { canjearSalto } from "../../../../lib/calendario-global/salto.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";
import { origenPeticion } from "../../../../lib/calendar/googleCalendar.js";

/**
 * GET /api/auth/saltar?t=… — el canje del pase del calendario global
 * (03/09/2026). Abre en el host del CRM la sesión de la cuenta que dice el
 * pase y manda al evento. Es la cuarta puerta de entrada, después del login,
 * el refresh y la demo, y se cierra igual de fuerte que el login:
 *
 *   · solo en el host del CRM (en el back-office y en el propio calendario,
 *     404: lo dicen las listas blancas del middleware, y aquí se repite por
 *     si algún día se relajan);
 *   · el pase se comprueba entero en lib/calendario-global/salto.js (firma
 *     propia, 60 s, un solo uso, cuenta viva y de ese tenant);
 *   · un pase malo devuelve al login SIN decir por qué, como una contraseña
 *     mala, y queda en la auditoría con el motivo.
 *
 * Los tokens que se firman son EXACTAMENTE los del login (mismo payload,
 * sello `bo: false`): a partir de aquí la sesión es una sesión normal.
 */
export async function GET(request) {
  if (esPeticionDeBackoffice(request) || esPeticionDeCalendario(request)) {
    return new NextResponse(null, { status: 404 });
  }
  const limitado = enforceRateLimit(request, { key: "auth-saltar", limit: 20, windowMs: 60_000 });
  if (limitado) return limitado;

  const ip = request.headers.get("x-forwarded-for") ?? null;
  const token = new URL(request.url).searchParams.get("t");
  // Dentro del contenedor `request.url` es http://localhost:3000: las
  // redirecciones se construyen sobre el host PÚBLICO que puso nginx, como
  // hace la conexión con Google (visto en producción el 03/09/2026: el canje
  // mandaba a localhost:3000/login).
  const origen = origenPeticion(request);

  let canje;
  try {
    canje = await canjearSalto(token);
  } catch (err) {
    await auditarLogin({ action: "auth.login_failed", email: "", ip, motivo: `salto:${err?.message ?? "invalido"}` });
    return NextResponse.redirect(new URL("/login", origen));
  }

  const { user, tenant, destino, desde } = canje;
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant.slug,
      bo: false,
    }),
    signRefreshToken({
      userId: user.id,
      tenantSlug: tenant.slug,
      tokenVersion: user.tokenVersion,
    }),
  ]);

  await user.update({ lastLoginAt: new Date() });
  await auditarLogin({
    action: "auth.login",
    email: user.email,
    ip,
    userId: user.id,
    tenantId: tenant.id,
    motivo: desde ? `calendario_global:${desde}` : "calendario_global",
  });

  const response = NextResponse.redirect(new URL(destino, origen), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}
