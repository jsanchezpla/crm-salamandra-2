import { Op, fn, col, literal } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getKpisForPeriod } from "../../../../lib/billing/billingSummary.js";
import { madridToday } from "../../../../lib/utils/madridDate.js";

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// La tabla `quotes` puede no existir aún (migración billing-quotes no aplicada).
// En ese caso el Panel operativo debe seguir funcionando con presupuestos = 0.
function isMissingRelation(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

/**
 * GET /api/billing/operations?from&to — datos del Panel operativo.
 *
 * Embudo del ciclo de vida (presupuestos → aceptados → facturado → cobrado)
 * y lista de "acción requerida" (facturas vencidas, presupuestos que caducan,
 * aceptados sin facturar). Facturado/Cobrado se acotan al periodo; el pipeline
 * de presupuestos es estado actual (no acotado a periodo).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Quote } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("from/to requeridos");

    // Facturado / Cobrado del periodo (base imponible, reutiliza los KPIs)
    const kpis = await getKpisForPeriod({ tenantModels, from, to });

    // El día se lee en MADRID, no en UTC (21/08/2026). `toISOString()` da el día
    // UTC corra el proceso donde corra, así que entre las 00:00 y las 02:00 de
    // Madrid en verano (01:00 en invierno) este panel se quedaba en el día de
    // ayer: una factura vencida anoche salía «vencida» en el listado, en la ficha
    // y en el resumen —los tres pasan por `effectiveStatus`— y este panel decía
    // «0 vencidas» de la misma factura. Antes los cuatro sitios estaban mal IGUAL
    // y al menos coincidían; al arreglar `lib/billing/invoiceStatus.js` esa misma
    // tarde, dejar este en UTC habría puesto a dos pantallas a contradecirse.
    const today = madridToday();
    // Los siete días se cuentan sobre el día de Madrid ya elegido, como
    // CALENDARIO y no como instante: sumar 7×86.400.000 ms cruza un cambio de
    // hora y se desvía sesenta minutos, que junto a la medianoche cambia el día.
    // `Date.UTC` con el día desbordado resuelve fin de mes y fin de año solo.
    const [aa, mm, dd] = today.split("-").map(Number);
    const in7str = new Date(Date.UTC(aa, mm - 1, dd + 7)).toISOString().slice(0, 10);

    // Pipeline de presupuestos (estado actual). Tolerante a que la tabla
    // `quotes` aún no exista (migración no aplicada): degrada a 0.
    let quoteAgg = [];
    try {
      quoteAgg = await Quote.findAll({
        attributes: ["status", [fn("COUNT", col("id")), "n"], [fn("SUM", col("total")), "sum"]],
        group: ["status"],
        raw: true,
      });
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    let openCount = 0, openSum = 0, accCount = 0, accSum = 0;
    for (const r of quoteAgg) {
      const n = Number(r.n || 0), s = Number(r.sum || 0);
      if (["draft", "sent", "viewed"].includes(r.status)) { openCount += n; openSum += s; }
      if (r.status === "accepted") { accCount += n; accSum += s; }
    }

    // Facturas vencidas (efectivas): emitidas/enviadas/parciales, vencidas, no cobradas del todo
    const overdueRows = await Invoice.findAll({
      where: {
        status: { [Op.in]: ["issued", "sent", "partially_paid"] },
        dueDate: { [Op.lt]: today },
        paidAmount: { [Op.lt]: col("total") },
      },
      attributes: [
        [fn("COUNT", col("id")), "n"],
        [literal("COALESCE(SUM(total - paid_amount), 0)"), "sum"],
      ],
      raw: true,
    });
    const overdueCount = Number(overdueRows[0]?.n || 0);
    const overdueSum = round2(Number(overdueRows[0]?.sum || 0));

    // Presupuestos que caducan en 7 días (tolerante a tabla ausente)
    let expiringRows = [];
    try {
      expiringRows = await Quote.findAll({
        where: {
          status: { [Op.in]: ["draft", "sent", "viewed"] },
          validUntil: { [Op.between]: [today, in7str] },
        },
        attributes: [[fn("COUNT", col("id")), "n"], [fn("SUM", col("total")), "sum"]],
        raw: true,
      });
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    const expCount = Number(expiringRows[0]?.n || 0);
    const expSum = round2(Number(expiringRows[0]?.sum || 0));

    return ok({
      period: { from, to },
      funnel: {
        presupuestos: { amount: round2(openSum), count: openCount },
        aceptados: { amount: round2(accSum), count: accCount },
        facturado: { amount: kpis.income.billedBase, count: kpis.income.invoiceCount },
        cobrado: { amount: kpis.income.collectedBase, pct: kpis.income.collectedPct },
      },
      actions: {
        overdue: { count: overdueCount, amount: overdueSum },
        expiring: { count: expCount, amount: expSum },
        acceptedNotInvoiced: { count: accCount, amount: round2(accSum) },
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
