import { NextResponse } from "next/server";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { verifyRefreshToken, signAccessToken, signRefreshToken, setAuthCookies, clearAuthCookies } from "../../../../lib/auth/jwt.js";

export async function POST(request) {
  const token = request.cookies.get("refresh_token")?.value;

  if (!token) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let payload;
  try {
    payload = await verifyRefreshToken(token);
  } catch {
    const response = NextResponse.json({ ok: false, error: "Token inválido o expirado" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const { User } = getMasterModels();
  const user = await User.scope("withPassword").findByPk(payload.userId);

  if (!user) {
    return NextResponse.json({ ok: false, error: "Usuario no encontrado" }, { status: 401 });
  }

  // Verificar tokenVersion para rotación — invalida tokens anteriores
  if (user.tokenVersion !== payload.tokenVersion) {
    const response = NextResponse.json({ ok: false, error: "Token revocado" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  // Rotar tokenVersion
  const newVersion = user.tokenVersion + 1;
  await user.update({ tokenVersion: newVersion });

  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantSlug: payload.tenantSlug,
  };

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken({ userId: user.id, tenantSlug: payload.tenantSlug, tokenVersion: newVersion }),
  ]);

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}
