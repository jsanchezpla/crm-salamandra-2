import { SignJWT, jwtVerify } from "jose";
import { COOKIE_SESION_CORTA } from "./sesionCorta.js";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh");

// TTL del access token: corto en producción (mitiga el daño de un token robado),
// largo en dev/local para no tener que re-loguear cada 15 min durante el trabajo.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ACCESS_TTL = IS_PRODUCTION ? "15m" : "8h";
// Se exporta (12/09/2026) para que la sesión «como admin» del calendario global
// marque su caducidad con el mismo número que la cookie de acceso.
export const ACCESS_TTL_SECONDS = IS_PRODUCTION ? 60 * 15 : 60 * 60 * 8;
const REFRESH_TTL = "7d";

export async function signAccessToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(REFRESH_SECRET);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, ACCESS_SECRET);
  return payload;
}

export async function verifyRefreshToken(token) {
  const { payload } = await jwtVerify(token, REFRESH_SECRET);
  return payload;
}

export function setAuthCookies(response, { accessToken, refreshToken }) {
  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });

  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  });

  // Una sesión que se abre o se renueva por aquí es normal: fuera la marca de
  // sesión corta que hubiera (12/09/2026). La rama «como admin» de
  // /api/auth/saltar la vuelve a poner DESPUÉS de llamar a esta función.
  borrarSesionCorta(response);
}

export function clearAuthCookies(response) {
  response.cookies.set("access_token", "", { maxAge: 0, path: "/" });
  response.cookies.set("refresh_token", "", { maxAge: 0, path: "/api/auth/refresh" });
  borrarSesionCorta(response);
}

/**
 * Marca la sesión como CORTA: no se renueva (12/09/2026, la sesión «como admin»
 * del calendario global, que no lleva refresh token).
 *
 * Por qué hace falta: SessionKeeper renueva a los 12 minutos y, sin refresh
 * token, el refresh da 401 y manda al login con el access token aún vivo. Esta
 * cookie le dice hasta cuándo NO intentarlo. No es httpOnly porque la lee el
 * navegador, y no autoriza nada: la sesión sigue siendo `access_token`. Su
 * valor es la caducidad en milisegundos (la del token, con los milisegundos
 * que tarde en firmarse de diferencia). Ver lib/auth/sesionCorta.js.
 */
export function marcarSesionCorta(
  response,
  { caducaEn = Date.now() + ACCESS_TTL_SECONDS * 1000 } = {}
) {
  response.cookies.set(COOKIE_SESION_CORTA, String(Math.round(caducaEn)), {
    httpOnly: false,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });
}

function borrarSesionCorta(response) {
  response.cookies.set(COOKIE_SESION_CORTA, "", { maxAge: 0, path: "/" });
}
