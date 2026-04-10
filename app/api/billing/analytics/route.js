import { fn, col, Op, literal } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../../lib/utils/apiResponse.js";

/**
 * GET /api/billing/analytics?from=2026-01-01&to=2026-12-31
 *
 * Devuelve KPIs completos del período:
 * - Ingresos (facturado, cobrado, pendiente, ticket medio, por servicio)
 * - Costes (total, salarios, fijos, variables, CAPEX)
 * - Márgenes (bruto, neto, EBITDA, OPEX)
 * - Evolución mensual de ingresos
 */
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Invoice, Payment, Cost } = tenantModels;
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!from || !to) return error("Los parámetros from y to son obligatorios (YYYY-MM-DD)");

    // Mes inicio/fin para filtros de costes (YYYY-MM)
    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);

    // ── 1. Ingresos facturados por período ──────────────────────────────────
    const invoiceRows = await Invoice.findAll({
      where: {
        status: { [Op.notIn]: ["cancelled", "draft"] },
        issueDate: { [Op.between]: [from, to] },
      },
      attributes: [
        [fn("SUM", col("total")), "totalBilled"],
        [fn("COUNT", col("id")), "invoiceCount"],
        [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"],
        "serviceType",
      ],
      group: ["serviceType"],
      raw: true,
    });

    const totalBilled = invoiceRows.reduce((s, r) => s + Number(r.totalBilled || 0), 0);
    const invoiceCount = invoiceRows.reduce((s, r) => s + Number(r.invoiceCount || 0), 0);
    const clientCount = invoiceRows.reduce((s, r) => s + Number(r.clientCount || 0), 0);

    const byServiceType = invoiceRows.map((r) => ({
      serviceType: r.serviceType || "sin_tipo",
      totalBilled: round2(Number(r.totalBilled || 0)),
      invoiceCount: Number(r.invoiceCount || 0),
    }));

    // ── 2. Total cobrado en el período ──────────────────────────────────────
    const paymentRows = await Payment.findAll({
      where: {
        status: "completed",
        paidAt: { [Op.between]: [`${from} 00:00:00`, `${to} 23:59:59`] },
      },
      attributes: [[fn("SUM", col("amount")), "totalCollected"]],
      raw: true,
    });

    const totalCollected = round2(Number(paymentRows[0]?.totalCollected || 0));
    const pendingCollection = round2(totalBilled - totalCollected);
    const averageTicket = invoiceCount > 0 ? round2(totalBilled / invoiceCount) : 0;
    const averageTicketPerClient = clientCount > 0 ? round2(totalBilled / clientCount) : 0;

    // ── 3. Evolución mensual de ingresos ────────────────────────────────────
    const monthlyRows = await Invoice.findAll({
      where: {
        status: { [Op.notIn]: ["cancelled", "draft"] },
        issueDate: { [Op.between]: [from, to] },
      },
      attributes: [
        [fn("TO_CHAR", fn("DATE_TRUNC", "month", col("issue_date")), "YYYY-MM"), "month"],
        [fn("SUM", col("total")), "totalBilled"],
        [fn("COUNT", col("id")), "count"],
      ],
      group: [fn("DATE_TRUNC", "month", col("issue_date"))],
      order: [[fn("DATE_TRUNC", "month", col("issue_date")), "ASC"]],
      raw: true,
    });

    const byMonth = monthlyRows.map((r) => ({
      month: r.month,
      totalBilled: round2(Number(r.totalBilled || 0)),
      count: Number(r.count || 0),
    }));

    // ── 4. Costes por tipo y categoría ──────────────────────────────────────
    const costRows = await Cost.findAll({
      where: { month: { [Op.between]: [fromMonth, toMonth] } },
      attributes: [
        [fn("SUM", col("amount")), "total"],
        "type",
        "category",
      ],
      group: ["type", "category"],
      raw: true,
    });

    const totalCosts = costRows.reduce((s, r) => s + Number(r.total || 0), 0);
    const salaryCost = costRows
      .filter((r) => r.type === "salary")
      .reduce((s, r) => s + Number(r.total || 0), 0);
    const fixedCosts = costRows
      .filter((r) => r.category === "fixed")
      .reduce((s, r) => s + Number(r.total || 0), 0);
    const variableCosts = costRows
      .filter((r) => r.category === "variable")
      .reduce((s, r) => s + Number(r.total || 0), 0);
    const capex = costRows
      .filter((r) => r.category === "capex")
      .reduce((s, r) => s + Number(r.total || 0), 0);
    const opex = round2(totalCosts - capex);

    // ── 5. Márgenes ─────────────────────────────────────────────────────────
    const grossMargin = round2(totalBilled - salaryCost);
    const grossMarginPct = totalBilled > 0 ? round2((grossMargin / totalBilled) * 100) : 0;
    const netMargin = round2(totalBilled - totalCosts + capex); // excluye CAPEX del neto operativo
    const netMarginPct = totalBilled > 0 ? round2((netMargin / totalBilled) * 100) : 0;
    const ebitda = round2(totalCollected - opex);

    return ok({
      period: { from, to },
      income: {
        totalBilled: round2(totalBilled),
        totalCollected,
        pendingCollection,
        invoiceCount,
        clientCount,
        averageTicket,
        averageTicketPerClient,
        byServiceType,
        byMonth,
      },
      costs: {
        total: round2(totalCosts),
        salaries: round2(salaryCost),
        fixed: round2(fixedCosts),
        variable: round2(variableCosts),
        capex: round2(capex),
        opex,
        breakdown: costRows.map((r) => ({
          type: r.type,
          category: r.category,
          total: round2(Number(r.total || 0)),
        })),
      },
      margins: {
        grossMargin,
        grossMarginPct,
        netMargin,
        netMarginPct,
        ebitda,
        opex,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
