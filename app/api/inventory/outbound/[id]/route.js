import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";

export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { OutboundProduct, Formula, InboundProduct, Client, ClientOutboundAlias } = tenantModels;
  const { id } = await params;

  const product = await OutboundProduct.findByPk(id, {
    include: [
      {
        model: Formula,
        as: "components",
        include: [
          { model: InboundProduct, as: "inboundProduct", attributes: ["id", "name"] },
          { model: Client, as: "client", attributes: ["id", "name"] },
        ],
      },
      {
        model: ClientOutboundAlias,
        as: "aliases",
        include: [{ model: Client, as: "client", attributes: ["id", "name"] }],
      },
    ],
  });
  if (!product) return notFound("Producto saliente no encontrado");

  return ok(product);
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { OutboundProduct } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const product = await OutboundProduct.findByPk(id);
  if (!product) return notFound("Producto saliente no encontrado");

  await product.update({
    name: body.name?.trim() || product.name,
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : product.tags,
    defaultSalePrice: "defaultSalePrice" in body ? (body.defaultSalePrice ? parseFloat(body.defaultSalePrice) : null) : product.defaultSalePrice,
    notes: "notes" in body ? (body.notes?.trim() || null) : product.notes,
  });
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.outbound.updated",
    entity: "OutboundProduct",
    entityId: product.id,
    after: resumen(product, ["name", "sku"]),
  });

  return ok(product);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("inventory")) return forbidden();

  const { OutboundProduct, Formula, ClientOutboundAlias, StockMovement } = tenantModels;
  const { id } = await params;

  const product = await OutboundProduct.findByPk(id);
  if (!product) return notFound("Producto saliente no encontrado");

  const formulaCount = await Formula.count({ where: { outboundProductId: id } });
  if (formulaCount > 0) {
    return error("No se puede eliminar: tiene recetas asociadas. Borra las recetas primero.", 409);
  }
  const aliasCount = await ClientOutboundAlias.count({ where: { outboundProductId: id } });
  if (aliasCount > 0) {
    return error("No se puede eliminar: tiene alias por cliente. Borra los alias primero.", 409);
  }
  const movementCount = await StockMovement.count({ where: { outboundProductId: id } });
  if (movementCount > 0) {
    return error("No se puede eliminar: tiene movimientos de stock históricos.", 409);
  }

  const antesBorrar = resumen(product, ["name", "sku"]);
  const idBorrado = product.id;
  await product.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "inventory.outbound.deleted",
    entity: "OutboundProduct",
    entityId: idBorrado,
    before: antesBorrar,
  });
  return noContent();
});
