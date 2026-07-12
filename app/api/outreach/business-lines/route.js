import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";

function isAdmin(request) {
  const role = request.headers.get("x-user-role");
  return role === "admin" || role === "superadmin";
}

/**
 * Líneas de negocio del tenant: aquello contra lo que se puntúa cada lead.
 *
 * Es la pieza que hace del módulo un producto y no una herramienta interna:
 * en vez del par fijo Solutions/Agencia, cada tenant define las suyas, y de
 * aquí sale el system prompt del análisis IA.
 */
export const GET = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { OutreachBusinessLine } = ctx.tenantModels;

  const includeInactive = new URL(request.url).searchParams.get("all") === "true";
  const lines = await OutreachBusinessLine.findAll({
    where: includeInactive ? {} : { active: true },
    order: [["sortOrder", "ASC"]],
  });

  return ok({ items: lines.map((l) => l.toJSON()) });
});

export const POST = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  if (!isAdmin(request)) throw new ForbiddenError("Solo un administrador puede crear líneas de negocio");
  const { OutreachBusinessLine } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const key = body?.key?.trim().toLowerCase();
  const name = body?.name?.trim();
  if (!key || !/^[a-z0-9_]+$/.test(key)) throw new ValidationError("La clave debe ser minúsculas, números o guión bajo");
  if (key.length > 64) throw new ValidationError("La clave no puede superar 64 caracteres");
  if (!name) throw new ValidationError("El nombre es obligatorio");
  if (name.length > 255) throw new ValidationError("El nombre no puede superar 255 caracteres");

  if (await OutreachBusinessLine.findOne({ where: { key } })) {
    throw new ValidationError(`Ya existe una línea con la clave "${key}"`);
  }

  const line = await OutreachBusinessLine.create({
    key,
    name,
    description: body.description ?? null,
    scoringUp: Array.isArray(body.scoringUp) ? body.scoringUp : [],
    scoringDown: Array.isArray(body.scoringDown) ? body.scoringDown : [],
    sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
    active: body.active !== false,
  });

  return created(line.toJSON());
});
