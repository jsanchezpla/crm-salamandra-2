import { NextResponse } from "next/server";
import { lineaDeLog, mensajeDeError, referenciaDeError } from "./errorInterno.js";

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

/**
 * El 500 de las ~285 rutas del CRM.
 *
 * Hasta el 09/09/2026 no escribía NADA: ni log, ni referencia, ni rastro. Por
 * eso no se pudo contestar el aviso de Olga («no funciona cobros, aparece como
 * error interno»). Lo que se escribe y lo que se enseña vive en
 * `lib/utils/errorInterno.js`, con su prueba; aquí solo se juntan.
 */
export function serverError(err) {
  const ref = referenciaDeError();
  console.error(lineaDeLog(err, ref));
  return error(mensajeDeError(err, ref), 500);
}
