import { NextResponse } from "next/server";
import { enforceRateLimit, getClientIp } from "../../../../lib/utils/rateLimit.js";
import { esPeticionDeBackoffice } from "../../../../lib/auth/backoffice.js";
import { iniciarRecuperacion } from "../../../../lib/auth/recuperacion.js";

/**
 * POST /api/auth/recuperar — «¿Olvidaste tu contraseña?», paso 1: el usuario.
 *
 * Puerta ANÓNIMA a propósito (está en PUBLIC_API_PATHS del middleware): quien
 * la necesita es justo quien no puede entrar. Por eso lleva su propio cerrojo
 * y por eso la respuesta no distingue un usuario real de uno inventado — solo
 * distingue el caso admin, que es a quien Rodrigo quiso decirle «mira tu
 * correo». Todo el porqué, en `lib/auth/recuperacion.js`.
 *
 * Devuelve siempre 200 con `{ ok: true, via: "correo" | "admin" }`.
 */
export async function POST(request) {
  // Por el back-office no hay recuperación: esa cuenta se restablece por SSH,
  // a propósito (más poder que ningún admin y otro host).
  if (esPeticionDeBackoffice(request)) {
    return NextResponse.json({ ok: false, error: "No disponible." }, { status: 404 });
  }

  // Cerrojo propio: es una puerta anónima que manda correos y campanas. Cinco
  // por IP cada cuarto de hora dan de sobra para equivocarse tecleando y no
  // dan para barrer usuarios ni para inundar a nadie.
  const limitado = enforceRateLimit(request, {
    key: "auth-recuperar",
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
  const usuario = typeof body?.usuario === "string" ? body.usuario.trim() : "";
  if (!usuario || usuario.length > 255) {
    return NextResponse.json({ ok: false, error: "Escribe tu usuario." }, { status: 400 });
  }

  // El enlace del correo se construye con el host por el que ha entrado la
  // petición: quien pide desde el CRM de su centro recibe un enlace a su CRM.
  const origen = new URL(request.url).origin;

  const { via } = await iniciarRecuperacion({
    identificador: usuario,
    origen,
    ip: getClientIp(request),
  });
  return NextResponse.json({ ok: true, via });
}
