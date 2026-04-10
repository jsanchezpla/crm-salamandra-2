import { SignJWT, jwtVerify } from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh");

const ACCESS_TTL = "15m";
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
  const isProduction = process.env.NODE_ENV === "production";

  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15, // 15 minutos
  });

  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  });
}

export function clearAuthCookies(response) {
  response.cookies.set("access_token", "", { maxAge: 0, path: "/" });
  response.cookies.set("refresh_token", "", { maxAge: 0, path: "/api/auth/refresh" });
}
