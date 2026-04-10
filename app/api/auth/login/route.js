import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const { email, password } = body;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ ok: false, error: "Email y contraseña requeridos" }, { status: 400 });
  }

  const { User, Tenant } = getMasterModels();

  // Buscar usuario por email con passwordHash
  const user = await User.scope("withPassword").findOne({
    where: { email: email.toLowerCase() },
  });

  // Siempre ejecutar bcrypt para evitar timing attacks
  const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000000";
  const hashToCheck = user?.passwordHash || dummyHash;
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!user || !passwordOk) {
    return NextResponse.json({ ok: false, error: "Credenciales incorrectas" }, { status: 401 });
  }

  // Obtener el tenant directamente desde el usuario — sin necesitar slug externo
  const tenant = await Tenant.findOne({
    where: { id: user.tenantId, status: "active" },
  });

  if (!tenant) {
    return NextResponse.json({ ok: false, error: "Credenciales incorrectas" }, { status: 401 });
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant.slug,
    }),
    signRefreshToken({
      userId: user.id,
      tenantSlug: tenant.slug,
      tokenVersion: user.tokenVersion,
    }),
  ]);

  await user.update({ lastLoginAt: new Date() });

  const response = NextResponse.json({
    ok: true,
    data: { id: user.id, email: user.email, role: user.role },
  });

  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}
