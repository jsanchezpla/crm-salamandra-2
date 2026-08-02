import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { Op } from "sequelize";

function puede(hasModule) {
  return hasModule("billing") || hasModule("inventory");
}

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!puede(hasModule)) return forbidden();

  const { Supplier, Cost } = tenantModels;
  const { id } = await params;

  const supplier = await Supplier.findByPk(id);
  if (!supplier) return notFound("Proveedor no encontrado");

  // Lo primero que se quiere saber al abrir un proveedor es cuánto se le lleva
  // pagado — la pregunta que antes no se podía responder.
  let totalGastado = 0;
  let numGastos = 0;
  if (hasModule("billing")) {
    const gastos = await Cost.findAll({ where: { supplierId: id }, attributes: ["id", "total"] });
    numGastos = gastos.length;
    totalGastado = gastos.reduce((s, g) => s + Number(g.total || 0), 0);
  }

  return ok({ ...supplier.toJSON(), totalGastado: +totalGastado.toFixed(2), numGastos });
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!puede(hasModule)) return forbidden();

  const { Supplier } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const supplier = await Supplier.findByPk(id);
  if (!supplier) return notFound("Proveedor no encontrado");

  if ("name" in body) {
    const name = body.name?.trim();
    if (!name) return error("El nombre del proveedor es obligatorio", 422);
    const choca = await Supplier.findOne({
      where: { name: { [Op.iLike]: name }, id: { [Op.ne]: id } },
    });
    if (choca) return error(`Ya existe otro proveedor llamado «${choca.name}»`, 409, { id: choca.id });
  }

  const campos = ["taxId", "email", "phone", "contactName", "address", "notes"];
  const cambios = {};
  if ("name" in body) cambios.name = body.name.trim();
  for (const c of campos) if (c in body) cambios[c] = body[c]?.trim() || null;
  if ("active" in body) cambios.active = !!body.active;

  await supplier.update(cambios);
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "suppliers.updated",
    entity: "Supplier",
    entityId: supplier.id,
    after: resumen(supplier, ["name", "taxId", "active"]),
  });

  return ok(supplier);
});

/**
 * Baja del proveedor. NO borra: sus gastos y entregas históricos apuntan aquí y
 * borrarlo dejaría el histórico sin nombre. Si de verdad no tiene nada colgando,
 * se borra de verdad — un proveedor creado por error no debe quedarse para
 * siempre en la lista de inactivos.
 */
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!puede(hasModule)) return forbidden();

  const { Supplier, Cost } = tenantModels;
  const { id } = await params;

  const supplier = await Supplier.findByPk(id);
  if (!supplier) return notFound("Proveedor no encontrado");

  const usos = hasModule("billing") ? await Cost.count({ where: { supplierId: id } }) : 0;

  if (usos > 0) {
    await supplier.update({ active: false });
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "suppliers.deactivated",
      entity: "Supplier",
      entityId: supplier.id,
      before: resumen(supplier, ["name", "taxId", "active"]),
    });
    return ok({ desactivado: true, usos, mensaje: `Dado de baja: tiene ${usos} gasto(s) asociados` });
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "suppliers.deleted",
    entity: "Supplier",
    entityId: supplier.id,
    before: resumen(supplier, ["name", "taxId", "active"]),
  });
  await supplier.destroy();
  return ok({ eliminado: true });
});
