/**
 * Tipos de error del CRM, SIN dependencias de Next.
 *
 * (Cambio en /lib, regla #2 — motivo abajo.)
 *
 * QUÉ ARREGLA: `lib/utils/errors.js` importa `NextResponse` de `next/server`
 * para poder construir la respuesta HTTP. Eso está bien dentro de la app, pero
 * `next/server` es un especificador que **Node no sabe resolver fuera del
 * empaquetador de Next**. Como las clases de error vivían en ese mismo fichero,
 * cualquier script de línea de comandos que acabara importándolas —casi siempre
 * sin saberlo, a través de `lib/tenant/tenantResolver.js`— moría nada más
 * arrancar con `ERR_MODULE_NOT_FOUND`, antes de ejecutar una sola línea suya.
 *
 * Eso dejó ROTOS diez scripts de mantenimiento, entre ellos
 * `scripts/enable-module.js`, que CLAUDE.md señala como LA vía correcta para
 * dar de alta un módulo. Se descubrió el 2026-07-31 activando `analytics` en
 * `spain_enzymes`, en producción.
 *
 * Aquí están solo las clases, que no necesitan Next para nada.
 * `lib/utils/errors.js` las reexporta, así que **ningún import existente
 * cambia** y `instanceof AppError` sigue funcionando igual: son las mismas
 * clases, no copias.
 */

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
