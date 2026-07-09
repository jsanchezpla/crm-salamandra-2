import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { irpfDeductionRange, IRPF_MARGINAL_MIN, IRPF_MARGINAL_MAX } from "../../../../../lib/billing/irpf.js";

function round2(n) { return Math.round(Number(n) * 100) / 100; }
const ACTIVE = { [Op.notIn]: ["draft", "cancelled", "rectified"] };

/**
 * GET /api/billing/analytics/partners?from&to
 *
 * Reparto por SOCIO (mientras no seamos SL, cada uno factura/deduce por su
 * cuenta) + total conjunto. Por socio:
 *   - facturado (base), IVA repercutido, IRPF retenido en sus facturas
 *   - gastos deducibles (base) e IRPF que se ahorra (rango 19%–47% del gasto)
 *   - neto = facturado − gastos
 * Y el mismo cálculo sumando a todos los socios (conjunto).
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Cost, TenantBillingSettings } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("from/to requeridos");

    const settings = await TenantBillingSettings.findOne();
    const partners = Array.isArray(settings?.partners) ? settings.partners : [];

    const invRows = await Invoice.findAll({
      where: { issueDate: { [Op.between]: [from, to] }, status: ACTIVE },
      attributes: [
        "partnerId",
        [fn("SUM", col("tax_base")), "billedBase"],
        [fn("SUM", col("vat_amount")), "vat"],
        [fn("SUM", col("irpf_amount")), "irpfRetained"],
        [fn("COUNT", col("id")), "count"],
      ],
      group: ["partnerId"],
      raw: true,
    });

    const costRows = await Cost.findAll({
      where: { incurredAt: { [Op.between]: [from, to] } },
      attributes: [
        "partnerId",
        [fn("SUM", col("tax_base")), "costBase"],
        [fn("COUNT", col("id")), "count"],
      ],
      group: ["partnerId"],
      raw: true,
    });

    const map = new Map();
    const slot = (pid) => {
      const key = pid || "__none__";
      if (!map.has(key)) {
        map.set(key, { partnerId: pid || null, billedBase: 0, vat: 0, irpfRetained: 0, invoiceCount: 0, costBase: 0, costCount: 0 });
      }
      return map.get(key);
    };
    for (const r of invRows) {
      const s = slot(r.partnerId);
      s.billedBase = round2(Number(r.billedBase || 0));
      s.vat = round2(Number(r.vat || 0));
      s.irpfRetained = round2(Number(r.irpfRetained || 0));
      s.invoiceCount = Number(r.count || 0);
    }
    for (const r of costRows) {
      const s = slot(r.partnerId);
      s.costBase = round2(Number(r.costBase || 0));
      s.costCount = Number(r.count || 0);
    }

    const nameOf = (pid) => partners.find((p) => p.id === pid)?.name || (pid || "Sin asignar");

    const rows = [...map.values()].map((s) => ({
      ...s,
      partnerName: nameOf(s.partnerId),
      net: round2(s.billedBase - s.costBase),
      irpfSaved: irpfDeductionRange(s.costBase),
    }));
    rows.sort((a, b) => (a.partnerId ? 0 : 1) - (b.partnerId ? 0 : 1) || b.billedBase - a.billedBase);

    const combined = rows.reduce(
      (acc, r) => {
        acc.billedBase = round2(acc.billedBase + r.billedBase);
        acc.vat = round2(acc.vat + r.vat);
        acc.irpfRetained = round2(acc.irpfRetained + r.irpfRetained);
        acc.invoiceCount += r.invoiceCount;
        acc.costBase = round2(acc.costBase + r.costBase);
        acc.costCount += r.costCount;
        return acc;
      },
      { billedBase: 0, vat: 0, irpfRetained: 0, invoiceCount: 0, costBase: 0, costCount: 0 }
    );
    combined.net = round2(combined.billedBase - combined.costBase);
    combined.irpfSaved = irpfDeductionRange(combined.costBase);

    return ok({
      period: { from, to },
      marginal: { min: IRPF_MARGINAL_MIN, max: IRPF_MARGINAL_MAX },
      partners: rows,
      combined,
    });
  } catch (err) {
    return serverError(err);
  }
});
