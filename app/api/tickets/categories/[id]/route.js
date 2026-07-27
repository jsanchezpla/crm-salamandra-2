import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { isAdminRequest, UUID_RE } from "@/lib/support/context.js";
import { serializeCategory } from "@/lib/support/serialize.js";

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** PATCH /api/tickets/categories/[id] — { name?, color?, sortOrder?, active? } (admin) */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const row = await ctx.tenantModels.TicketCategory.findByPk(id);
    if (!row) return notFound("Categoría no encontrada");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const cambios = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return error("El nombre no puede quedar vacío", 422);
      cambios.name = name;
    }
    if (body.color !== undefined) {
      cambios.color = body.color === null ? null : COLOR_RE.test(body.color) ? body.color : row.color;
    }
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      cambios.sortOrder = Number(body.sortOrder);
    }
    if (body.active !== undefined) cambios.active = body.active === true;

    await row.update(cambios);
    return ok(serializeCategory(row));
  } catch (err) {
    return serverError(err);
  }
});

/** DELETE /api/tickets/categories/[id] — borrar (admin). Los tickets quedan sin categoría. */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { TicketCategory, Ticket } = ctx.tenantModels;
    const row = await TicketCategory.findByPk(id);
    if (!row) return notFound("Categoría no encontrada");

    // La FK es SET NULL, pero en schemas creados por db:sync no existe: se
    // desvincula explícitamente para no dejar categoryId huérfanos.
    await Ticket.update({ categoryId: null }, { where: { categoryId: id } });
    await row.destroy();
    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
});
