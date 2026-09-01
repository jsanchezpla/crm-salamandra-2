import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, notFound } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { limpiarMovimiento, saldoDeMovimientos } from "../../../../lib/billing/caja.js";

/**
 * Entradas y salidas de caja (01/09/2026, petición de Aumenta: «poder hacer
 * entradas y salidas de caja, donde figure fecha, importe, concepto y
 * observaciones»).
 *
 *   GET  ?cajaId=&desde=&hasta=  → los apuntes del periodo, con su saldo
 *   POST { cashPointId, date, direction, amount, concept, notes? }
 *
 * Es dinero: se audita. Y cuenta para el arqueo — lo esperado en el cajón pasa
 * a ser fondo + cobros en efectivo + entradas − salidas (ver `cierres/route.js`).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashMovement, CashPoint, TeamMember } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const cajaId = searchParams.get("cajaId");
  if (cajaId) where.cashPointId = cajaId;
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  if (desde && hasta) where.date = { [Op.between]: [desde, hasta] };
  else if (desde) where.date = { [Op.gte]: desde };
  else if (hasta) where.date = { [Op.lte]: hasta };
  if (searchParams.get("direccion") === "in" || searchParams.get("direccion") === "out") {
    where.direction = searchParams.get("direccion");
  }

  const movimientos = await CashMovement.findAll({
    where,
    order: [["date", "DESC"], ["createdAt", "DESC"]],
    limit: Math.min(500, Number(searchParams.get("limit") || 200)),
    include: [
      { model: CashPoint, as: "cashPoint", attributes: ["id", "name"] },
      { model: TeamMember, as: "createdBy", attributes: ["id", "displayName"] },
    ],
  });

  return ok({
    movimientos,
    total: movimientos.length,
    saldo: saldoDeMovimientos(movimientos.map((m) => m.toJSON())),
  });
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashMovement, CashPoint } = tenantModels;
  const body = await request.json();

  const { valores, problema } = limpiarMovimiento(body);
  if (problema) return error(problema, 422);

  const caja = await CashPoint.findByPk(valores.cashPointId);
  if (!caja) return notFound("Caja no encontrada");

  const createdById = await resolveCurrentTeamMemberId(request, tenantModels);
  const movimiento = await CashMovement.create({ ...valores, createdById: createdById || null });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "cash_movement.created",
    entity: "CashMovement",
    entityId: movimiento.id,
    after: resumen(movimiento, ["date", "direction", "amount", "concept"]),
  });

  return created(movimiento);
});
