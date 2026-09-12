import { NextResponse } from "next/server";
import {
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  marcarSesionCorta,
} from "../../../../lib/auth/jwt.js";
import { esPeticionDeBackoffice, esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { auditarLogin } from "../../../../lib/auth/loginGuard.js";
import { canjearSalto } from "../../../../lib/calendario-global/salto.js";
import { auditar } from "../../../../lib/utils/auditoria.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";
import { origenPeticion } from "../../../../lib/calendar/googleCalendar.js";

/**
 * GET /api/auth/saltar?t=… — el canje del pase del calendario global
 * (03/09/2026). Abre en el host del CRM la sesión de la cuenta que dice el
 * pase y manda a su destino. Es la cuarta puerta de entrada, después del
 * login, el refresh y la demo, y se cierra igual de fuerte que el login:
 *
 *   · solo en el host del CRM (en el back-office y en el propio calendario,
 *     404: lo dicen las listas blancas del middleware, y aquí se repite por
 *     si algún día se relajan);
 *   · el pase se comprueba entero en lib/calendario-global/salto.js (firma
 *     propia, 60 s, un solo uso, cuenta viva y de ese tenant);
 *   · un pase malo devuelve al login SIN decir por qué, como una contraseña
 *     mala, y queda en la auditoría con el motivo.
 *
 * Con la cuenta vinculada (`como: "cuenta"`) los tokens que se firman son
 * EXACTAMENTE los del login (mismo payload, sello `bo: false`): a partir de
 * aquí la sesión es una sesión normal.
 *
 * ── «COMO ADMIN» (12/09/2026) ───────────────────────────────────────────────
 * Un admin de Salamandra entrando con la cuenta admin de un cliente
 * (`como: "admin"`) abre una sesión CORTA y a la vista:
 *   · solo `access_token` (mismo payload que el login), SIN refresh token, y
 *     se borra la cookie `refresh_token` que hubiera. `/api/auth/refresh` rota
 *     `tokenVersion` POR USUARIO: una sesión nuestra renovándose echaría a la
 *     dirección del cliente de la suya. Dura lo que el access token (15 min en
 *     producción) y luego se vuelve a pulsar «Abrir en el CRM».
 *   · el access token lleva además `imp` (el id de la cuenta de Salamandra,
 *     `desde`) y se pone la cookie `sesion_corta` con su caducidad (12/09/2026,
 *     revisión del v2). `imp` lo lee `withTenant` para revalidar en CADA
 *     petición que quien entró sigue siendo admin de Salamandra (degradarle
 *     corta la sesión al instante, no a los 15 minutos) y para que toda fila de
 *     auditoría de esa sesión guarde `after.comoAdminDesde`. `sesion_corta`
 *     la lee SessionKeeper para no intentar renovar: sin ella, a los 12 minutos
 *     el refresh daba 401 y mandaba al login con el token aún vivo.
 *   · NO toca `lastLoginAt`: el back-office y Equipo lo leen como «última
 *     entrada» del cliente, y no entró él.
 *   · se audita en el tenant DEL CLIENTE con el usuario de Salamandra
 *     (`desde`): `auth.login` con motivo y `calendario_global.salto.como_admin`
 *     con la cuenta usada, para que salga en SU Actividad quién entró.
 * Ver docs/decisions/2026-09-12-el-calendario-global-ve-todos-y-los-proyectos.md.
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

  const { user, tenant, destino, desde, como } = canje;

  if (como === "admin") {
    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant.slug,
      bo: false,
      // Quién hay detrás de verdad. El middleware no lo mira (la sesión es la
      // de la cuenta del cliente); lo usa withTenant, que verifica la firma.
      imp: desde,
    });

    await auditarLogin({
      action: "auth.login",
      email: user.email,
      ip,
      userId: desde,
      tenantId: tenant.id,
      motivo: "calendario_global:como_admin",
    });
    await auditar({
      tenantId: tenant.id,
      userId: desde,
      ip,
      action: "calendario_global.salto.como_admin",
      entity: "User",
      entityId: user.id,
      after: { comoUsuario: user.email, destino },
    });

    const response = NextResponse.redirect(new URL(destino, origen), { status: 303 });
    response.headers.set("Cache-Control", "no-store");
    // Las opciones de la cookie de acceso salen de un solo sitio (jwt.js); la
    // de refresh se sobrescribe a continuación con una vacía y caducada (las
    // cookies de la respuesta se guardan por nombre: gana la última).
    setAuthCookies(response, { accessToken, refreshToken: "" });
    response.cookies.set("refresh_token", "", { maxAge: 0, path: "/api/auth/refresh" });
    // DESPUÉS de setAuthCookies, que borra la marca: aquí gana la última.
    marcarSesionCorta(response);
    return response;
  }

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
