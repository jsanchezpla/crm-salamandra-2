import { NextResponse } from "next/server";

// Las clases viven en errorTypes.js, que NO depende de Next. Se reexportan aquí
// para que los ~200 imports existentes de este fichero sigan funcionando tal
// cual. El motivo del desdoble está explicado en lib/utils/errorTypes.js:
// resumido, `next/server` no se resuelve fuera del empaquetador de Next y eso
// mataba a los scripts de línea de comandos que arrastraban estas clases.
import { AppError } from "./errorTypes.js";

export {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "./errorTypes.js";

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
