import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Formula } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const formula = await Formula.findByPk(id);
  if (!formula) return notFound("Receta no encontrada");

  if ("qtyKgPerOutputKg" in body) {
    const qty = Number(body.qtyKgPerOutputKg);
    if (!isFinite(qty) || qty <= 0) return error("qtyKgPerOutputKg debe ser mayor que 0", 422);
    formula.qtyKgPerOutputKg = qty;
  }
  if ("notes" in body) formula.notes = body.notes?.trim() || null;

  await formula.save();
  return ok(formula);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { Formula } = tenantModels;
  const { id } = await params;

  const formula = await Formula.findByPk(id);
  if (!formula) return notFound("Receta no encontrada");

  const antesBorrar = resumen(formula, ["outboundProductId", "inboundProductId", "qtyKgPerOutputKg"]);
  const idBorrado = formula.id;
  await formula.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.formula.deleted",
    entity: "Formula",
    entityId: idBorrado,
    before: antesBorrar,
  });
  return noContent();
});
