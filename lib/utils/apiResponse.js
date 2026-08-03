import { NextResponse } from "next/server";

export function ok(data, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function created(data) {
  return ok(data, 201);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function error(message, status = 400, details = null) {
  const body = { ok: false, error: message };
  if (details && process.env.NODE_ENV !== "production") {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

/**
 * Error CON datos que la pantalla necesita para reaccionar (un código que
 * distinga el caso, un enlace al que mandar a la persona…).
 *
 * Existe porque el tercer argumento de `error()` es `details`, y `details` se
 * borra en producción a propósito: lleva interioridades para depurar. Quien lo
 * use para mandar algo que la UI necesita se encuentra con que funciona en
 * local y desaparece en el servidor. Aquí los datos viajan SIEMPRE, así que lo
 * que se meta tiene que ser apto para el usuario final: nada de trazas,
 * consultas ni nombres de tabla.
 */
export function errorConDatos(message, status, datos) {
  return NextResponse.json({ ok: false, error: message, ...datos }, { status });
}

export function unauthorized(message = "No autorizado") {
  return error(message, 401);
}

export function forbidden(message = "Acceso denegado") {
  return error(message, 403);
}

export function notFound(message = "Recurso no encontrado") {
  return error(message, 404);
}

export function serverError(err) {
  const message =
    process.env.NODE_ENV === "production" ? "Error interno del servidor" : err?.message || "Error desconocido";
  return error(message, 500);
}
