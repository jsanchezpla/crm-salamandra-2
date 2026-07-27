import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { isAdminRequest } from "@/lib/support/context.js";
import { serializeTemplate } from "@/lib/support/serialize.js";

/** GET /api/tickets/templates — plantillas de respuesta del tenant. */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const rows = await ctx.tenantModels.TicketTemplate.findAll({
      order: [["sortOrder", "ASC"], ["name", "ASC"]],
    });
    return ok({ templates: rows.map(serializeTemplate) });
  } catch (err) {
    return serverError(err);
  }
});

/** POST /api/tickets/templates — crear (solo admin). Body: { name, body } */
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
    const name = String(body?.name || "").trim().slice(0, 120);
    const texto = String(body?.body || "").trim();
    if (!name || !texto) return error("Nombre y texto son obligatorios", 422);

    const { TicketTemplate } = ctx.tenantModels;
    const max = await TicketTemplate.max("sortOrder");
    const row = await TicketTemplate.create({
      name,
      body: texto,
      sortOrder: Number.isFinite(max) ? max + 1 : 0,
    });
    return created(serializeTemplate(row));
  } catch (err) {
    return serverError(err);
  }
});
