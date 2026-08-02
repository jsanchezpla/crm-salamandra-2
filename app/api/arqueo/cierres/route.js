import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, notFound } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { Op } from "sequelize";

/**
 * Cierres de caja (arqueo).
 *
 * Cerrar el día = contar el dinero del cajón y compararlo con lo que el sistema
 * dice que debería haber. El descuadre es TODO el valor del registro.
 *
 * El «esperado» lo calcula el servidor, nunca el navegador: si lo mandara el
 * cliente, cuadrar la caja sería teclear el mismo número dos veces y el arqueo
 * no detectaría nada.
 */

/**
 * Lo que debería haber: fondo inicial + cobros en efectivo de ese día.
 *
 * ⚠️ LIMITACIÓN CONOCIDA: `Payment` no guarda en QUÉ caja se cobró, así que con
 * dos o más cajas el esperado sale igual para todas y el arqueo dejaría de
 * cuadrar. Hoy no afecta a nadie —Aumenta tiene una sola caja («Recepción»), y
 * es lo normal— pero el día que un cliente abra la segunda hay que añadir
 * `payments.cash_point_id` ANTES, no después. Se recibe `cashPointId` ya para
 * no cambiar la firma cuando llegue ese día.
 */
async function calcularEsperado(tenantModels, cashPointId, fecha, openingAmount) {
  const { Payment } = tenantModels;

  // Ventana del día completo en hora local del servidor.
  const desde = new Date(`${fecha}T00:00:00`);
  const hasta = new Date(`${fecha}T23:59:59.999`);

  const cobros = await Payment.findAll({
    where: {
      method: "cash",
      status: "completed",
      paidAt: { [Op.between]: [desde, hasta] },
    },
    attributes: ["id", "amount"],
  });

  const efectivo = cobros.reduce((s, p) => s + Number(p.amount || 0), 0);
  return {
    efectivoDelDia: +efectivo.toFixed(2),
    numCobros: cobros.length,
    esperado: +(Number(openingAmount || 0) + efectivo).toFixed(2),
  };
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashClose, CashPoint, TeamMember } = tenantModels;
  const { searchParams } = new URL(request.url);

  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const cajaId = searchParams.get("cajaId");
  // Para la pantalla de revisión: solo los días que NO cuadraron.
  const soloDescuadres = searchParams.get("soloDescuadres") === "1";

  const where = {};
  if (cajaId) where.cashPointId = cajaId;
  if (desde && hasta) where.closeDate = { [Op.between]: [desde, hasta] };
  else if (desde) where.closeDate = { [Op.gte]: desde };
  else if (hasta) where.closeDate = { [Op.lte]: hasta };
  if (soloDescuadres) where.difference = { [Op.ne]: 0 };

  const cierres = await CashClose.findAll({
    where,
    order: [["closeDate", "DESC"]],
    include: [
      { model: CashPoint, as: "cashPoint", attributes: ["id", "name"] },
      { model: TeamMember, as: "closedBy", attributes: ["id", "name"] },
    ],
  });

  const totalDescuadre = cierres.reduce((s, c) => s + Number(c.difference || 0), 0);

  return ok({
    cierres,
    total: cierres.length,
    conDescuadre: cierres.filter((c) => Number(c.difference) !== 0).length,
    totalDescuadre: +totalDescuadre.toFixed(2),
  });
});

/**
 * Vista previa del cierre: lo que el sistema espera encontrar en el cajón.
 * Se pide ANTES de contar, para que la persona no vea la cifra objetivo y
 * "ajuste" el conteo a ella... por eso el POST recalcula y no se fía de esto.
 */
export const PATCH = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const body = await request.json();
  if (!body.closeDate) return error("Falta la fecha del cierre", 422);

  const calc = await calcularEsperado(tenantModels, body.cashPointId, body.closeDate, body.openingAmount);
  return ok(calc);
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("billing")) return forbidden();

  const { CashClose, CashPoint } = tenantModels;
  const body = await request.json();

  if (!body.cashPointId) return error("Falta la caja", 422);
  if (!body.closeDate) return error("Falta la fecha del cierre", 422);
  if (body.countedAmount === undefined || body.countedAmount === null || body.countedAmount === "") {
    return error("Falta el dinero contado: es el dato que da sentido al arqueo", 422);
  }

  const caja = await CashPoint.findByPk(body.cashPointId);
  if (!caja) return notFound("Caja no encontrada");

  const yaCerrado = await CashClose.findOne({
    where: { cashPointId: body.cashPointId, closeDate: body.closeDate },
  });
  if (yaCerrado) {
    return error(`Esa caja ya se cerró el ${body.closeDate}`, 409, { id: yaCerrado.id });
  }

  const openingAmount = Number(body.openingAmount || 0);
  const countedAmount = Number(body.countedAmount);
  if (Number.isNaN(countedAmount)) return error("El dinero contado no es un número", 422);

  // Recalculado en el servidor a propósito: ver cabecera.
  const { esperado } = await calcularEsperado(tenantModels, body.cashPointId, body.closeDate, openingAmount);
  const difference = +(countedAmount - esperado).toFixed(2);

  // Un descuadre sin explicación no vale de nada dentro de seis meses.
  if (difference !== 0 && !body.notes?.trim()) {
    return error(
      `La caja no cuadra (${difference > 0 ? "sobran" : "faltan"} ${Math.abs(difference).toFixed(2)} €). Explica el motivo antes de cerrar.`,
      422,
      { difference, esperado }
    );
  }

  const closedById = await resolveCurrentTeamMemberId(request, tenantModels);

  const cierre = await CashClose.create({
    cashPointId: body.cashPointId,
    closeDate: body.closeDate,
    openingAmount,
    expectedAmount: esperado,
    countedAmount,
    difference,
    notes: body.notes?.trim() || null,
    closedById: closedById || null,
  });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "arqueo.cierre.created",
    entity: "CashClose",
    entityId: cierre.id,
    after: resumen(cierre, ["closeDate", "expectedAmount", "countedAmount", "difference"]),
  });

  return created(cierre);
});
