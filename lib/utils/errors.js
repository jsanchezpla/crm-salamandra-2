import { NextResponse } from "next/server";

export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autorizado") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acceso denegado") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Datos inválidos") {
    super(message, 422);
    this.name = "ValidationError";
  }
}

/**
 * Convierte cualquier error en una respuesta HTTP consistente.
 * Usar en el catch de los Route Handlers.
 */
export function handleRouteError(err) {
  if (err instanceof AppError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.statusCode });
  }
  console.error("[ServerError]", err);
  const message =
    process.env.NODE_ENV === "production" ? "Error interno del servidor" : err.message;
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
