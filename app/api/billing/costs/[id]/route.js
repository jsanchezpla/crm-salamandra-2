import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../../lib/billing/audit.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { camposGasto } from "../../../../../lib/billing/camposGasto.js";
import { computeCostTotals } from "../../../../../lib/billing/totalesGasto.js";

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Client, Supplier } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id, {
      include: [
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Client, as: "client", attributes: ["id", "name"] },
        { model: Supplier, as: "supplier", attributes: ["id", "name"] },
      ],
    });
    if (!cost) return notFound("Coste no encontrado");
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Cost, Supplier } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");

    const body = await request.json();
    const updates = camposGasto(body);

    // El proveedor tiene que ser de ESTE tenant: `Supplier` sale de
    // `tenantModels`, así que un id de otro cliente no aparece aquí.
    if (updates.supplierId) {
      const proveedor = await Supplier.findByPk(updates.supplierId, { attributes: ["id"] });
      if (!proveedor) return notFound("Proveedor no encontrado");
    }

    // Si cambian taxBase o vatRate, recalcular taxAmount y total
    if ("taxBase" in body || "vatRate" in body) {
      const totals = computeCostTotals({
        taxBase: body.taxBase ?? cost.taxBase,
        vatRate: body.vatRate ?? cost.vatRate,
      });
      Object.assign(updates, totals);
    }

    const antes = resumenImporte(cost);
    await cost.update(updates);
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "cost.updated",
      entity: "Cost",
      entityId: cost.id,
      before: antes,
      after: resumenImporte(cost),
    });
    return ok(cost);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Cost } = tenantModels;
    const { id } = await params;
    const cost = await Cost.findByPk(id);
    if (!cost) return notFound("Coste no encontrado");
    const antesBorrar = resumenImporte(cost);
    const idGasto = cost.id;
    await cost.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "cost.deleted",
      entity: "Cost",
      entityId: idGasto,
      before: antesBorrar,
      after: null,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
