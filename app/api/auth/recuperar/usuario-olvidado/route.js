import { NextResponse } from "next/server";
import { enforceRateLimit, getClientIp } from "../../../../../lib/utils/rateLimit.js";
import { incidenciaUsuarioOlvidado } from "../../../../../lib/auth/recuperacion.js";

/**
 * POST /api/auth/recuperar/usuario-olvidado — ni la contraseña ni el usuario.
 *
 * Abre una incidencia en el buzón de Salamandra con lo que la persona sepa
 * decir de sí misma (empresa, nombre, cargo) y nos avisa por correo. La
 * identificación y el restablecimiento se hacen a mano: aquí no se toca
 * ninguna cuenta.
 *
 * El cerrojo es el más prieto de los tres: no hay nada que reintentar — o se
 * mandó o no — y cada petición acaba en la bandeja de una persona.
 */
export async function POST(request) {
  const limitado = enforceRateLimit(request, {
    key: "auth-recuperar-usuario",
    limit: 3,
    windowMs: 60 * 60_000,
  });
  if (limitado) return limitado;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const res = await incidenciaUsuarioOlvidado({
    empresa: body?.empresa,
    cargo: body?.cargo,
    nombre: body?.nombre,
    correo: body?.correo,
    usuario: body?.usuario,
    ip: getClientIp(request),
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
