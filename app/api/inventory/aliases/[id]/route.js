import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { ClientOutboundAlias } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const alias = await ClientOutboundAlias.findByPk(id);
  if (!alias) return notFound("Alias no encontrado");

  if ("aliasName" in body) {
    if (!body.aliasName?.trim()) return error("aliasName no puede estar vacío", 422);
    alias.aliasName = body.aliasName.trim();
  }
  if ("customSalePrice" in body) {
    alias.customSalePrice = body.customSalePrice ? parseFloat(body.customSalePrice) : null;
  }

  await alias.save();
  return ok(alias);
});

export const DELETE = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { ClientOutboundAlias } = tenantModels;
  const { id } = await params;

  const alias = await ClientOutboundAlias.findByPk(id);
  if (!alias) return notFound("Alias no encontrado");

  await alias.destroy();
  return noContent();
});
