import { fn, col, Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/billing/analytics/employees?from=2026-01-01&to=2026-12-31
 *
 * Ficha por empleado:
 * - Ingresos generados
 * - Coste salarial
 * - Margen generado y %
 * - Nº facturas / ticket medio
 * - Tasa de cancelaciones (facturas canceladas vs total emitidas)
 */
export const GET = withTenant(async (request, _ctx, { tenantModels }) => {
  try {
    const { Invoice, Cost, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Los parámetros from y to son obligatorios (YYYY-MM-DD)");

    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);

    // ── Ingresos por empleado ────────────────────────────────────────────────
    const invoiceRows = await Invoice.findAll({
      where: {
        employeeId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: { [Op.notIn]: ["draft"] },
      },
      attributes: [
        "employeeId",
        [fn("SUM", col("total")), "totalBilled"],
        [fn("COUNT", col("id")), "invoiceCount"],
        [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"],
      ],
      group: ["employeeId"],
      raw: true,
    });

    // ── Facturas canceladas por empleado (tasa de cancelación) ──────────────
    const cancelledRows = await Invoice.findAll({
      where: {
        employeeId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: "cancelled",
      },
      attributes: [
        "employeeId",
        [fn("COUNT", col("id")), "cancelledCount"],
      ],
      group: ["employeeId"],
      raw: true,
    });

    const cancelledMap = new Map(
      cancelledRows.map((r) => [r.employeeId, Number(r.cancelledCount || 0)])
    );

    // ── Costes salariales por empleado ──────────────────────────────────────
    const costRows = await Cost.findAll({
      where: {
        type: "salary",
        employeeId: { [Op.ne]: null },
        month: { [Op.between]: [fromMonth, toMonth] },
      },
      attributes: [
        "employeeId",
        [fn("SUM", col("amount")), "salaryCost"],
      ],
      group: ["employeeId"],
      raw: true,
    });

    const costMap = new Map(
      costRows.map((r) => [r.employeeId, round2(Number(r.salaryCost || 0))])
    );

    // ── Datos de los empleados ──────────────────────────────────────────────
    const employeeIds = [...new Set(invoiceRows.map((r) => r.employeeId))];
    const employees = await TeamMember.findAll({
      where: { id: employeeIds },
      attributes: ["id", "displayName", "position"],
    });

    const employeeMap = new Map(employees.map((t) => [t.id, t]));

    // ── Combinar ─────────────────────────────────────────────────────────────
    const result = invoiceRows.map((row) => {
      const employee = employeeMap.get(row.employeeId);
      const income = round2(Number(row.totalBilled || 0));
      const invoiceCount = Number(row.invoiceCount || 0);
      const clientCount = Number(row.clientCount || 0);
      const cancelledCount = cancelledMap.get(row.employeeId) || 0;
      const salaryCost = costMap.get(row.employeeId) || 0;
      const margin = round2(income - salaryCost);
      const marginPct = income > 0 ? round2((margin / income) * 100) : 0;
      const cancellationRate =
        invoiceCount + cancelledCount > 0
          ? round2((cancelledCount / (invoiceCount + cancelledCount)) * 100)
          : 0;

      return {
        employeeId: row.employeeId,
        employeeName: employee?.displayName ?? "Desconocido",
        position: employee?.position ?? null,
        income,
        invoiceCount,
        clientCount,
        averageTicket: invoiceCount > 0 ? round2(income / invoiceCount) : 0,
        salaryCost,
        margin,
        marginPct,
        cancelledCount,
        cancellationRate,
      };
    });

    // Ordenar por margen desc
    result.sort((a, b) => b.margin - a.margin);

    return ok(result);
  } catch (err) {
    return serverError(err);
  }
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
