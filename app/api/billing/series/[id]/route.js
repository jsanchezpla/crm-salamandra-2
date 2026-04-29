import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const PATCH = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { InvoiceSeries } = tenantModels;
    const series = await InvoiceSeries.findByPk(id);
    if (!series) return notFound("Serie no encontrada");

    const body = await request.json();
    const updates = {};
    if ("name" in body) updates.name = String(body.name);
    if ("prefix" in body) updates.prefix = String(body.prefix);
    if ("isDefault" in body) updates.isDefault = !!body.isDefault;
    // No permitimos editar nextNumber a mano (rompe correlatividad fiscal)
    await series.update(updates);
    return ok(series);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { InvoiceSeries, Invoice } = tenantModels;
    const series = await InvoiceSeries.findByPk(id);
    if (!series) return notFound("Serie no encontrada");

    const used = await Invoice.count({ where: { series: series.code } });
    if (used > 0) return error(`No se puede borrar: ${used} facturas usan esta serie`, 409);

    await series.destroy();
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
