import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error, notFound } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";
import { limpiarMovimiento } from "../../../../../lib/billing/caja.js";

/**
 * PATCH/DELETE /api/arqueo/movimientos/[id] — corregir o borrar un apunte de
 * caja (01/09/2026).
 *
 * Un apunte de un día YA CERRADO no se toca: el cierre guardó la foto de lo que
 * se contó y de lo que se esperaba, y cambiar el apunte de debajo dejaría un
 * arqueo que no se puede reconstruir. Se corrige con un apunte nuevo, que es lo
 * que hace la contabilidad de toda la vida.
 */
async function frenarSiEstaCerrado(tenantModels, movimiento) {
  const { CashClose } = tenantModels;
  const cerrado = await CashClose.findOne({
    where: { cashPointId: movimiento.cashPointId, closeDate: movimiento.date },
    attributes: ["id"],
  });
  return cerrado
    ? `El día ${movimiento.date} ya está cerrado: no se puede tocar lo que había en el cajón. Apunta el ajuste con fecha de hoy.`
    : null;
}

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashMovement } = tenantModels;
  const { id } = await params;
  const movimiento = await CashMovement.findByPk(id);
  if (!movimiento) return notFound("Movimiento no encontrado");

  const frenado = await frenarSiEstaCerrado(tenantModels, movimiento);
  if (frenado) return error(frenado, 409);

  const body = await request.json();
  const { valores, problema } = limpiarMovimiento(body, { parcial: true });
  if (problema) return error(problema, 422);
  // La caja no se cambia por PATCH: mover un apunte de cajón descuadra dos
  // arqueos a la vez. Se borra y se apunta en la otra.
  delete valores.cashPointId;

  const antes = resumen(movimiento, ["date", "direction", "amount", "concept"]);
  await movimiento.update(valores);

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "cash_movement.created", // misma familia; el before dice que es una corrección
    entity: "CashMovement",
    entityId: movimiento.id,
    before: antes,
    after: resumen(movimiento, ["date", "direction", "amount", "concept"]),
  });

  return ok(movimiento);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashMovement } = tenantModels;
  const { id } = await params;
  const movimiento = await CashMovement.findByPk(id);
  if (!movimiento) return notFound("Movimiento no encontrado");

  const frenado = await frenarSiEstaCerrado(tenantModels, movimiento);
  if (frenado) return error(frenado, 409);

  const antes = resumen(movimiento, ["date", "direction", "amount", "concept"]);
  await movimiento.destroy();

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "cash_movement.deleted",
    entity: "CashMovement",
    entityId: id,
    before: antes,
  });

  return ok({ borrado: true });
});
