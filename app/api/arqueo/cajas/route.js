import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";

/**
 * Cajas — los puntos donde se cobra en efectivo.
 *
 * Casi todos los clientes tendrán UNA. Existe como lista porque el arqueo se
 * cuadra POR caja: con dos cajones físicos y un solo registro, un descuadre no
 * se puede atribuir a nadie.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashPoint } = tenantModels;
  const { searchParams } = new URL(request.url);
  const incluirInactivas = searchParams.get("incluirInactivas") === "1";

  const where = incluirInactivas ? {} : { active: true };
  const cajas = await CashPoint.findAll({ where, order: [["name", "ASC"]] });

  return ok({ cajas, total: cajas.length });
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashPoint } = tenantModels;
  const body = await request.json();

  const name = body.name?.trim();
  if (!name) return error("El nombre de la caja es obligatorio", 422);

  const caja = await CashPoint.create({ name, notes: body.notes?.trim() || null });
  return created(caja);
});
