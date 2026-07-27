import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { isAdminRequest } from "@/lib/support/context.js";
import { serializeCategory } from "@/lib/support/serialize.js";

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** GET /api/tickets/categories — todas (la UI de gestión también quiere las inactivas). */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const rows = await ctx.tenantModels.TicketCategory.findAll({
      order: [["sortOrder", "ASC"], ["name", "ASC"]],
    });
    return ok({ categories: rows.map(serializeCategory) });
  } catch (err) {
    return serverError(err);
  }
});

/** POST /api/tickets/categories — crear (solo admin). Body: { name, color? } */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const name = String(body?.name || "").trim().slice(0, 80);
    if (!name) return error("El nombre es obligatorio", 422);
    const color = COLOR_RE.test(body?.color || "") ? body.color : null;

    const { TicketCategory } = ctx.tenantModels;
    const max = await TicketCategory.max("sortOrder");
    const row = await TicketCategory.create({
      name,
      color,
      sortOrder: Number.isFinite(max) ? max + 1 : 0,
    });
    return created(serializeCategory(row));
  } catch (err) {
    return serverError(err);
  }
});
