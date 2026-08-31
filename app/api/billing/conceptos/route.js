import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../lib/billing/audit.js";
import { limpiarConcepto } from "../../../../lib/billing/conceptosCatalogo.js";

/**
 * GET/POST /api/billing/conceptos — el catálogo de conceptos y cuotas.
 *
 * GET: los activos por defecto (?todos=1 trae también los apagados), en el
 * orden del catálogo (sort_order, luego nombre). POST: alta con los campos
 * saneados por lib/billing/conceptosCatalogo.js, auditada — es config del
 * dinero, no una nota.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept } = tenantModels;
    const { searchParams } = new URL(request.url);
    const where = searchParams.get("todos") === "1" ? {} : { active: true };
    const conceptos = await BillingConcept.findAll({
      where,
      order: [["sortOrder", "ASC"], ["name", "ASC"]],
    });
    return ok({ conceptos });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { BillingConcept } = tenantModels;
    const body = await request.json();
    const { valores, problema } = limpiarConcepto(body);
    if (problema) return error(problema, 422);

    const concepto = await BillingConcept.create(valores);
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "billing_concept.created",
      entity: "BillingConcept",
      entityId: concepto.id,
      before: null,
      after: { nombre: concepto.name, importe: String(concepto.unitPrice), iva: String(concepto.vatRate) },
    });
    return created(concepto);
  } catch (err) {
    return serverError(err);
  }
});
