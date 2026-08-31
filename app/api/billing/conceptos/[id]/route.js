import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../lib/billing/audit.js";
import { limpiarConcepto } from "../../../../../lib/billing/conceptosCatalogo.js";

/** PATCH/DELETE /api/billing/conceptos/[id] — editar o retirar un concepto. */
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept } = tenantModels;
    const { id } = await params;
    const concepto = await BillingConcept.findByPk(id);
    if (!concepto) return notFound("Concepto no encontrado");

    const body = await request.json();
    const { valores, problema } = limpiarConcepto(body, { parcial: true });
    if (problema) return error(problema, 422);
    if ("active" in body) valores.active = !!body.active;

    await concepto.update(valores);
    return ok(concepto);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept } = tenantModels;
    const { id } = await params;
    const concepto = await BillingConcept.findByPk(id);
    if (!concepto) return notFound("Concepto no encontrado");

    const resumen = { nombre: concepto.name, importe: String(concepto.unitPrice) };
    await concepto.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "billing_concept.deleted",
      entity: "BillingConcept",
      entityId: id,
      before: resumen,
      after: null,
    });
    return ok({ borrado: true });
  } catch (err) {
    return serverError(err);
  }
});
