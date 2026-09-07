import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error, notFound } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { Op } from "sequelize";
import { saldoDeMovimientos } from "../../../../lib/billing/caja.js";
import { madridDayRange } from "../../../../lib/utils/madridDate.js";

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
 * Lo que debería haber: fondo inicial + cobros en efectivo del día + entradas
 * − salidas de caja (01/09/2026).
 *
 * Los apuntes de caja (`cash_movements`) entraron aquí porque sin ellos el
 * arqueo descuadraba todos los días: por el cajón pasa la mensajería, el sobre
 * para el banco y el cambio, y nada de eso es un cobro. Esos sí van filtrados
 * por caja, que es de donde salieron.
 *
 * El día es el de MADRID y no el del servidor (que en producción va en UTC):
 * agrupando por el del servidor, un cobro de las 00:30 caía en el día anterior
 * y el arqueo no cuadraba con lo que la persona acababa de contar.
 *
 * ⚠️ LIMITACIÓN CONOCIDA, la de siempre: `Payment` no guarda en QUÉ caja se
 * cobró, así que con dos o más cajas la parte de COBROS sale igual para todas.
 * Hoy no afecta a nadie —Aumenta tiene una sola caja («Recepción»), y es lo
 * normal— pero el día que un cliente abra la segunda hay que añadir
 * `payments.cash_point_id` ANTES, no después.
 */
async function calcularEsperado(tenantModels, cashPointId, fecha, openingAmount) {
  const { Payment, CashMovement } = tenantModels;

  // Ventana del día completo en hora de MADRID (exacta en los cambios de hora).
  const { start, end } = madridDayRange(new Date(`${fecha}T12:00:00Z`));

  // Un cobro DEVUELTO también entró en el cajón el día que se cobró: lo que
  // sale es la devolución, y sale el día de `refundedAt` (07/09/2026).
  const cobros = await Payment.findAll({
    where: {
      method: "cash",
      paidAt: { [Op.gte]: start, [Op.lt]: end },
      // El devuelto solo cuenta como entrado si SE SABE cuándo salió: sin
      // `refunded_at` la salida no se apunta en ningún día y el esperado subiría
      // por un dinero que ya no está en el cajón (misma regla que `haEntrado`).
      [Op.or]: [{ status: "completed" }, { status: "refunded", refundedAt: { [Op.ne]: null } }],
    },
    attributes: ["id", "amount"],
  });
  const devoluciones = await Payment.findAll({
    where: {
      method: "cash",
      status: "refunded",
      refundedAt: { [Op.gte]: start, [Op.lt]: end },
    },
    attributes: ["id", "amount"],
  });

  const movimientos = cashPointId
    ? await CashMovement.findAll({
        where: { cashPointId, date: fecha },
        attributes: ["id", "direction", "amount"],
      })
    : [];

  const efectivo = cobros.reduce((s, p) => s + Number(p.amount || 0), 0);
  const devuelto = devoluciones.reduce((s, p) => s + Math.abs(Number(p.amount || 0)), 0);
  const caja = saldoDeMovimientos(movimientos.map((m) => m.toJSON()));
  return {
    efectivoDelDia: +efectivo.toFixed(2),
    numCobros: cobros.length,
    // Lo devuelto en efectivo ese día: sale del cajón como una salida más.
    devueltoDelDia: +devuelto.toFixed(2),
    numDevoluciones: devoluciones.length,
    entradas: caja.entradas,
    salidas: caja.salidas,
    numMovimientos: movimientos.length,
    esperado: +(Number(openingAmount || 0) + efectivo - devuelto + caja.neto).toFixed(2),
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
      { model: TeamMember, as: "closedBy", attributes: ["id", "displayName"] },
    ],
  });

  const totalDescuadre = cierres.reduce((s, c) => s + Number(c.difference || 0), 0);

  /*
   * El ÚLTIMO cierre de esa caja, al margen del filtro de fechas (07/09/2026,
   * AV-0067): es de donde sale el fondo que se propone para el cierre
   * siguiente, y si dependiera del rango que hay puesto en pantalla la
   * propuesta desaparecería justo cuando alguien mira una semana concreta.
   * Van solo los dos campos que hacen falta.
   */
  let ultimoCierre = null;
  if (cajaId) {
    const ultimo = await CashClose.findOne({
      where: { cashPointId: cajaId },
      order: [["closeDate", "DESC"], ["createdAt", "DESC"]],
      attributes: ["closeDate", "countedAmount", "closedById"],
    });
    if (ultimo) {
      ultimoCierre = {
        closeDate: ultimo.closeDate,
        countedAmount: ultimo.countedAmount,
        // Si nadie lo cerró, no hubo conteo: los 828 cierres que Aumenta
        // importó de Organízate están a cero y sin autor, y proponer ese cero
        // sería inventarse un dato. Viaja resumido, sin el id de la persona.
        hechoPorUnaPersona: Boolean(ultimo.closedById),
      };
    }
  }

  return ok({
    cierres,
    total: cierres.length,
    conDescuadre: cierres.filter((c) => Number(c.difference) !== 0).length,
    totalDescuadre: +totalDescuadre.toFixed(2),
    ultimoCierre,
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

  /*
   * El FONDO en blanco no es un cero (07/09/2026). Antes daba casi igual, porque
   * el fondo se tecleaba siempre y casi siempre era 0; desde que se arrastra el
   * saldo de un día al siguiente, un fondo vacío vale cientos de euros y
   * `Number("" || 0)` lo convertía en 0 sin decir nada: el esperado salía corto
   * justo por el fondo, el arqueo cantaba un descuadre falso de ese importe y
   * encima pedía un motivo para algo que no había pasado. Se exige igual que el
   * dinero contado, y un cajón que abre vacío se escribe 0, que es un dato.
   */
  if (body.openingAmount === undefined || body.openingAmount === null || body.openingAmount === "") {
    return error("Falta el fondo inicial: escribe cuánto había en el cajón al abrir (0 si estaba vacío)", 422);
  }
  const openingAmount = Number(body.openingAmount);
  if (Number.isNaN(openingAmount)) return error("El fondo inicial no es un número", 422);
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
