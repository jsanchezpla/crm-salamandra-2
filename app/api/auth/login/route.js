import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";
import { esPeticionDeBackoffice } from "../../../../lib/auth/backoffice.js";
import {
  comprobarIntentoLogin,
  registrarFalloLogin,
  limpiarFallosLogin,
  auditarLogin,
  bloqueoYaAvisado,
  tenantDeEmail,
} from "../../../../lib/auth/loginGuard.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const { email: rawEmail, password } = body;

  if (!rawEmail || !password || typeof rawEmail !== "string" || typeof password !== "string") {
    return NextResponse.json({ ok: false, error: "Email y contraseña requeridos" }, { status: 400 });
  }

  // Normaliza el email (defensivo: autofill móvil puede meter espacios).
  // El password NO se trimea: puede contener espacios intencionales.
  const email = rawEmail.trim().toLowerCase();

  // Cerrojo ANTES de tocar la BD: por cuenta+IP (el duro), por IP (barrido
  // automático) y por cuenta a secas con umbral alto (ataque distribuido
  // contra un mismo usuario). Ver lib/auth/loginGuard.js.
  const cerrojo = comprobarIntentoLogin(request, email);
  if (cerrojo.bloqueado) {
    // Solo la PRIMERA vez de cada ventana: si no, el propio ataque llenaría
    // la tabla de auditoría a base de intentos.
    if (!bloqueoYaAvisado(email)) {
      const quien = await tenantDeEmail(email);
      await auditarLogin({
        action: "auth.login_blocked",
        email,
        ip: cerrojo.ip,
        motivo: cerrojo.motivo,
        userId: quien?.userId ?? null,
        tenantId: quien?.tenantId ?? null,
      });
    }
    console.warn(`[auth] login BLOQUEADO motivo=${cerrojo.motivo} ip=${cerrojo.ip}`);
    return NextResponse.json(
      { ok: false, error: `Demasiados intentos. Prueba de nuevo en ${cerrojo.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(cerrojo.retryAfter), "Cache-Control": "no-store" } }
    );
  }

  const { User, Tenant } = getMasterModels();

  const user = await User.scope("withPassword").findOne({
    where: { email },
  });

  // Siempre ejecutar bcrypt para evitar timing attacks
  const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000000";
  const hashToCheck = user?.passwordHash || dummyHash;
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!user || !passwordOk) {
    // Mismo mensaje exista o no el usuario (no se filtra qué emails son reales),
    // pero en la auditoría SÍ se distingue: es lo que permite ver un ataque.
    registrarFalloLogin(cerrojo.ip, email);
    await auditarLogin({
      action: "auth.login_failed",
      email,
      ip: cerrojo.ip,
      userId: user?.id ?? null,
      tenantId: user?.tenantId ?? null,
      motivo: user ? "password" : "usuario_inexistente",
    });
    return NextResponse.json({ ok: false, error: "Credenciales incorrectas" }, { status: 401 });
  }

  // ── ¿Puede esta cuenta entrar POR AQUÍ? ──────────────────────────────────
  // El back-office guarda la ficha de todos los clientes, así que tiene su
  // propia cuenta: las del CRM no valen allí, y la suya no vale en el CRM.
  //
  // Va DESPUÉS de comprobar la contraseña, no antes, y a propósito: cortar
  // aquí antes de ejecutar bcrypt convertiría el tiempo de respuesta en un
  // chivato de qué cuentas son de back-office. Por lo mismo la respuesta es
  // exactamente la misma que la de una contraseña mala; quien lo intente no
  // aprende nada. Lo que sí distingue el motivo es la auditoría, que es donde
  // hace falta verlo.
  const enBackoffice = esPeticionDeBackoffice(request);
  if (user.soloBackoffice !== enBackoffice) {
    registrarFalloLogin(cerrojo.ip, email);
    await auditarLogin({
      action: "auth.login_failed",
      email,
      ip: cerrojo.ip,
      userId: user.id,
      tenantId: user.tenantId,
      motivo: user.soloBackoffice ? "cuenta_solo_backoffice" : "cuenta_no_backoffice",
    });
    console.warn(
      `[auth] login RECHAZADO por host: ${email} ${user.soloBackoffice ? "es de back-office y entró por el CRM" : "es del CRM y entró por el back-office"}`
    );
    return NextResponse.json({ ok: false, error: "Credenciales incorrectas" }, { status: 401 });
  }

  // Obtener el tenant directamente desde el usuario — sin necesitar slug externo
  const tenant = await Tenant.findOne({
    where: { id: user.tenantId, status: "active" },
  });

  if (!tenant) {
    registrarFalloLogin(cerrojo.ip, email);
    await auditarLogin({
      action: "auth.login_failed",
      email,
      ip: cerrojo.ip,
      userId: user.id,
      tenantId: user.tenantId,
      motivo: "tenant_inactivo",
    });
    return NextResponse.json({ ok: false, error: "Credenciales incorrectas" }, { status: 401 });
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant.slug,
      // Sello de dónde nace la sesión. El middleware exige que coincida con el
      // host en CADA petición: sin él, este token valdría igual en el panel
      // interno con solo copiar la cookie.
      bo: enBackoffice,
    }),
    signRefreshToken({
      userId: user.id,
      tenantSlug: tenant.slug,
      tokenVersion: user.tokenVersion,
    }),
  ]);

  limpiarFallosLogin(email, cerrojo.ip);
  await user.update({ lastLoginAt: new Date() });
  await auditarLogin({
    action: "auth.login",
    email,
    ip: cerrojo.ip,
    userId: user.id,
    tenantId: tenant.id,
  });

  const response = NextResponse.json({
    ok: true,
    data: { id: user.id, email: user.email, role: user.role },
  });

  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}
