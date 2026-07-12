import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAdmin(request) {
  const role = request.headers.get("x-user-role");
  return role === "admin" || role === "superadmin";
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!isAdmin(request)) throw new ForbiddenError("Solo un administrador puede editar líneas de negocio");
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachBusinessLine } = ctx.tenantModels;
  const line = await OutreachBusinessLine.findByPk(id);
  if (!line) throw new NotFoundError("Línea de negocio no encontrada");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const patch = {};
  if ("name" in body) {
    const name = body.name?.trim();
    if (!name) throw new ValidationError("El nombre no puede quedar vacío");
    if (name.length > 255) throw new ValidationError("El nombre no puede superar 255 caracteres");
    patch.name = name;
  }
  if ("description" in body) patch.description = body.description ?? null;
  if ("scoringUp" in body) {
    if (!Array.isArray(body.scoringUp)) throw new ValidationError("scoringUp debe ser una lista");
    patch.scoringUp = body.scoringUp;
  }
  if ("scoringDown" in body) {
    if (!Array.isArray(body.scoringDown)) throw new ValidationError("scoringDown debe ser una lista");
    patch.scoringDown = body.scoringDown;
  }
  if ("sortOrder" in body && Number.isInteger(body.sortOrder)) patch.sortOrder = body.sortOrder;
  if ("active" in body) patch.active = Boolean(body.active);

  if (Object.keys(patch).length === 0) throw new ValidationError("Nada que actualizar");

  // `key` es inmutable a propósito: los análisis ya guardados se identifican
  // por ella y renombrarla rompería la trazabilidad.
  await line.update(patch);
  return ok(line.toJSON());
});

/**
 * Borrar una línea arrastra sus análisis (ON DELETE CASCADE). Para conservar el
 * histórico, la UI ofrece desactivarla (`active:false`) en vez de borrarla.
 */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!isAdmin(request)) throw new ForbiddenError("Solo un administrador puede borrar líneas de negocio");
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");

  const { OutreachBusinessLine } = ctx.tenantModels;
  const line = await OutreachBusinessLine.findByPk(id);
  if (!line) throw new NotFoundError("Línea de negocio no encontrada");

  await line.destroy();
  return noContent();
});
