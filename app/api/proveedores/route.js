import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

/**
 * Proveedores — a quién le compra el centro.
 *
 * El gate es `billing` O `inventory` a propósito: el proveedor es la MISMA
 * ficha para las dos cosas (te factura y te entrega mercancía), así que un
 * tenant que solo tenga uno de los dos módulos debe poder mantener su lista.
 * Gatearlo solo por `inventory` dejaría a un centro sin almacén sin poder decir
 * a quién paga.
 */
function puede(hasModule) {
  return hasModule("billing") || hasModule("inventory");
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!puede(hasModule)) return forbidden();

  const { Supplier } = tenantModels;
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  // Por defecto solo los activos: la lista sirve para ELEGIR proveedor, y los
  // dados de baja solo estorban. `?incluirInactivos=1` para la pantalla de
  // gestión.
  const incluirInactivos = searchParams.get("incluirInactivos") === "1";

  const where = {};
  if (!incluirInactivos) where.active = true;
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { taxId: { [Op.iLike]: `%${search}%` } },
      { contactName: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const suppliers = await Supplier.findAll({ where, order: [["name", "ASC"]] });
  return ok({ suppliers, total: suppliers.length });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!puede(hasModule)) return forbidden();

  const { Supplier } = tenantModels;
  const body = await request.json();

  const name = body.name?.trim();
  if (!name) return error("El nombre del proveedor es obligatorio", 422);

  // Un mismo proveedor dado de alta dos veces es justo el problema que este
  // modelo viene a resolver (antes era texto libre en cada entrega), así que se
  // corta aquí en vez de dejar que se dupliquen.
  const yaExiste = await Supplier.findOne({ where: { name: { [Op.iLike]: name } } });
  if (yaExiste) {
    return error(`Ya existe un proveedor llamado «${yaExiste.name}»`, 409, { id: yaExiste.id });
  }

  const supplier = await Supplier.create({
    name,
    taxId: body.taxId?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    contactName: body.contactName?.trim() || null,
    address: body.address?.trim() || null,
    notes: body.notes?.trim() || null,
  });

  return created(supplier);
});
