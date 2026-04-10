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
