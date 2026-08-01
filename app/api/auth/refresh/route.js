import { NextResponse } from "next/server";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";
import { verifyRefreshToken, signAccessToken, signRefreshToken, setAuthCookies, clearAuthCookies } from "../../../../lib/auth/jwt.js";
import { esPeticionDeBackoffice } from "../../../../lib/auth/backoffice.js";

export async function POST(request) {
  // Sin límite, un refresh token robado se podía renovar en bucle sin coste.
  const limitado = enforceRateLimit(request, { key: "auth-refresh", limit: 20, windowMs: 60_000 });
  if (limitado) return limitado;

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

  const { User, Tenant } = getMasterModels();
  const user = await User.scope("withPassword").findByPk(payload.userId);

  if (!user) {
    return NextResponse.json({ ok: false, error: "Usuario no encontrado" }, { status: 401 });
  }

  // El login exige tenant activo; el refresh también debe hacerlo. Si no, al
  // suspender un cliente (impago, baja) sus usuarios seguirían renovando
  // sesión indefinidamente mientras conservaran el refresh token.
  const tenant = await Tenant.findOne({ where: { id: user.tenantId, status: "active" }, attributes: ["id"] });
  if (!tenant) {
    const response = NextResponse.json({ ok: false, error: "Cuenta no disponible" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  // Verificar tokenVersion para rotación — invalida tokens anteriores
  if (user.tokenVersion !== payload.tokenVersion) {
    const response = NextResponse.json({ ok: false, error: "Token revocado" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  // ── El refresh es la OTRA puerta, y tenía el candado sin poner ────────────
  // El login ya comprobaba que la cuenta corresponda al host, pero aquí no se
  // miraba nada: bastaba entrar por el CRM, quedarse el refresh token y
  // canjearlo contra el subdominio del panel para salir con una sesión válida
  // allí. Un refresh token es un portador puro; que la cookie sea httpOnly no
  // protege de quien ES el cliente (curl), que es justo el atacante del que este
  // panel se defiende.
  const enBackoffice = esPeticionDeBackoffice(request);
  if (user.soloBackoffice !== enBackoffice) {
    const response = NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
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
    // El mismo sello que pone el login: si no se arrastrara, la primera
    // renovación devolvería un token sin marca y el middleware lo tomaría por
    // sesión del CRM, echando a la persona del panel cada 15 minutos.
    bo: enBackoffice,
  };

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken({ userId: user.id, tenantSlug: payload.tenantSlug, tokenVersion: newVersion }),
  ]);

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}
