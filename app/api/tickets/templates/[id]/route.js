import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { isAdminRequest, UUID_RE } from "@/lib/support/context.js";
import { serializeTemplate } from "@/lib/support/serialize.js";

/** PATCH /api/tickets/templates/[id] — { name?, body?, sortOrder?, active? } (admin) */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const row = await ctx.tenantModels.TicketTemplate.findByPk(id);
    if (!row) return notFound("Plantilla no encontrada");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const cambios = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return error("El nombre no puede quedar vacío", 422);
      cambios.name = name;
    }
    if (body.body !== undefined) {
      const texto = String(body.body || "").trim();
      if (!texto) return error("El texto no puede quedar vacío", 422);
      cambios.body = texto;
    }
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      cambios.sortOrder = Number(body.sortOrder);
    }
    if (body.active !== undefined) cambios.active = body.active === true;

    await row.update(cambios);
    return ok(serializeTemplate(row));
  } catch (err) {
    return serverError(err);
  }
});

/** DELETE /api/tickets/templates/[id] — borrar (admin). */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const row = await ctx.tenantModels.TicketTemplate.findByPk(id);
    if (!row) return notFound("Plantilla no encontrada");
    await row.destroy();
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
});
