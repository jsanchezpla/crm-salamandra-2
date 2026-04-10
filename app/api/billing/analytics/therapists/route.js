import { fn, col, Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/billing/analytics/therapists?from=2026-01-01&to=2026-12-31
 *
 * Ficha por terapeuta:
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

    // ── Ingresos por terapeuta ───────────────────────────────────────────────
    const invoiceRows = await Invoice.findAll({
      where: {
        therapistId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: { [Op.notIn]: ["draft"] },
      },
      attributes: [
        "therapistId",
        [fn("SUM", col("total")), "totalBilled"],
        [fn("COUNT", col("id")), "invoiceCount"],
        [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"],
      ],
      group: ["therapistId"],
      raw: true,
    });

    // ── Facturas canceladas por terapeuta (tasa de cancelación) ─────────────
    const cancelledRows = await Invoice.findAll({
      where: {
        therapistId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: "cancelled",
      },
      attributes: [
        "therapistId",
        [fn("COUNT", col("id")), "cancelledCount"],
      ],
      group: ["therapistId"],
      raw: true,
    });

    const cancelledMap = new Map(
      cancelledRows.map((r) => [r.therapistId, Number(r.cancelledCount || 0)])
    );

    // ── Costes salariales por terapeuta ─────────────────────────────────────
    const costRows = await Cost.findAll({
      where: {
        type: "salary",
        therapistId: { [Op.ne]: null },
        month: { [Op.between]: [fromMonth, toMonth] },
      },
      attributes: [
        "therapistId",
        [fn("SUM", col("amount")), "salaryCost"],
      ],
      group: ["therapistId"],
      raw: true,
    });

    const costMap = new Map(
      costRows.map((r) => [r.therapistId, round2(Number(r.salaryCost || 0))])
    );

    // ── Datos de los terapeutas ──────────────────────────────────────────────
    const therapistIds = [...new Set(invoiceRows.map((r) => r.therapistId))];
    const therapists = await TeamMember.findAll({
      where: { id: therapistIds },
      attributes: ["id", "displayName", "position"],
    });

    const therapistMap = new Map(therapists.map((t) => [t.id, t]));

    // ── Combinar ─────────────────────────────────────────────────────────────
    const result = invoiceRows.map((row) => {
      const therapist = therapistMap.get(row.therapistId);
      const income = round2(Number(row.totalBilled || 0));
      const invoiceCount = Number(row.invoiceCount || 0);
      const clientCount = Number(row.clientCount || 0);
      const cancelledCount = cancelledMap.get(row.therapistId) || 0;
      const salaryCost = costMap.get(row.therapistId) || 0;
      const margin = round2(income - salaryCost);
      const marginPct = income > 0 ? round2((margin / income) * 100) : 0;
      const cancellationRate =
        invoiceCount + cancelledCount > 0
          ? round2((cancelledCount / (invoiceCount + cancelledCount)) * 100)
          : 0;

      return {
        therapistId: row.therapistId,
        therapistName: therapist?.displayName ?? "Desconocido",
        position: therapist?.position ?? null,
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
