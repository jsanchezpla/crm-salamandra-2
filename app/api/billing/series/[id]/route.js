import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";


export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

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
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "invoice_series.updated",
      entity: "InvoiceSeries",
      entityId: series.id,
      after: resumen(series, ["prefix", "name", "nextNumber"]),
    });
    return ok(series);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { id } = await params;
    const { InvoiceSeries, Invoice } = tenantModels;
    const series = await InvoiceSeries.findByPk(id);
    if (!series) return notFound("Serie no encontrada");

    const used = await Invoice.count({ where: { series: series.code } });
    if (used > 0) return error(`No se puede borrar: ${used} facturas usan esta serie`, 409);

    const antesBorrar = resumen(series, ["prefix", "name", "nextNumber"]);
    const idBorrado = series.id;
    await series.destroy();
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "invoice_series.deleted",
      entity: "InvoiceSeries",
      entityId: idBorrado,
      before: antesBorrar,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
