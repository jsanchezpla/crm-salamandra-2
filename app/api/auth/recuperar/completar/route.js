import { NextResponse } from "next/server";
import { enforceRateLimit, getClientIp } from "../../../../../lib/utils/rateLimit.js";
import { completarRecuperacion } from "../../../../../lib/auth/recuperacion.js";

/**
 * POST /api/auth/recuperar/completar — el enlace del correo, paso 2: la
 * contraseña nueva. Anónima como su hermana (la sesión aquí no existe: la
 * abre quien perdió la contraseña); lo que autentica es el token del enlace,
 * de un solo uso y con caducidad. `lib/auth/recuperacion.js` hace el resto:
 * bcrypt nuevo, token fuera y `tokenVersion` arriba para tirar sesiones vivas.
 */
export async function POST(request) {
  // Más prieto que el paso 1: aquí cada intento es una consulta por hash y,
  // si acierta, un bcrypt. Y probar tokens al azar no es equivocarse: es
  // atacar (2^256 no se barre, pero tampoco se regala el intento).
  const limitado = enforceRateLimit(request, {
    key: "auth-recuperar-completar",
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (limitado) return limitado;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const res = await completarRecuperacion({
    token: body?.token,
    password: body?.password,
    ip: getClientIp(request),
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
