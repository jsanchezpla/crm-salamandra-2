import { Op, fn, col } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { irpfDeductionRange } from "@/lib/billing/irpf.js";
import { xlsxResponse, MONEY_FMT } from "@/lib/billing/exportXlsx.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ACTIVE = { [Op.notIn]: ["draft", "cancelled", "rectified"] };
const NUM = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const range = (r) => `${NUM.format(Number(r?.min || 0))} € – ${NUM.format(Number(r?.max || 0))} €`;

/** GET /api/billing/exports/by-partner?from&to — Analítica por socio a XLSX. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
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
      attributes: ["partnerId", [fn("SUM", col("tax_base")), "billedBase"], [fn("SUM", col("vat_amount")), "vat"], [fn("SUM", col("irpf_amount")), "irpfRetained"], [fn("COUNT", col("id")), "count"]],
      group: ["partnerId"],
      raw: true,
    });
    const costRows = await Cost.findAll({
      where: { incurredAt: { [Op.between]: [from, to] } },
      attributes: ["partnerId", [fn("SUM", col("tax_base")), "costBase"], [fn("COUNT", col("id")), "count"]],
      group: ["partnerId"],
      raw: true,
    });

    const map = new Map();
    const slot = (pid) => {
      const key = pid || "__none__";
      if (!map.has(key)) map.set(key, { partnerId: pid || null, billedBase: 0, vat: 0, irpfRetained: 0, invoiceCount: 0, costBase: 0, costCount: 0 });
      return map.get(key);
    };
    for (const r of invRows) { const s = slot(r.partnerId); s.billedBase = round2(Number(r.billedBase || 0)); s.vat = round2(Number(r.vat || 0)); s.irpfRetained = round2(Number(r.irpfRetained || 0)); s.invoiceCount = Number(r.count || 0); }
    for (const r of costRows) { const s = slot(r.partnerId); s.costBase = round2(Number(r.costBase || 0)); s.costCount = Number(r.count || 0); }

    const nameOf = (pid) => partners.find((p) => p.id === pid)?.name || (pid || "Sin asignar");
    const rows = [...map.values()].map((s) => ({ ...s, partnerName: nameOf(s.partnerId), net: round2(s.billedBase - s.costBase), irpfSaved: irpfDeductionRange(s.costBase) }));
    rows.sort((a, b) => (a.partnerId ? 0 : 1) - (b.partnerId ? 0 : 1) || b.billedBase - a.billedBase);

    const combined = rows.reduce((acc, r) => { acc.billedBase = round2(acc.billedBase + r.billedBase); acc.irpfRetained = round2(acc.irpfRetained + r.irpfRetained); acc.costBase = round2(acc.costBase + r.costBase); return acc; }, { billedBase: 0, irpfRetained: 0, costBase: 0 });
    combined.net = round2(combined.billedBase - combined.costBase);
    combined.irpfSaved = irpfDeductionRange(combined.costBase);

    const columns = [
      { header: "Socio", key: "partnerName", width: 24 },
      { header: "Facturado", key: "billedBase", width: 14, numFmt: MONEY_FMT },
      { header: "IRPF retenido", key: "irpfRetained", width: 14, numFmt: MONEY_FMT },
      { header: "Gastos", key: "costBase", width: 14, numFmt: MONEY_FMT },
      { header: "IRPF que ahorra", key: "irpfSaved", width: 24 },
      { header: "Neto", key: "net", width: 14, numFmt: MONEY_FMT },
    ];
    const data = rows.map((r) => ({ partnerName: r.partnerName, billedBase: r.billedBase, irpfRetained: r.irpfRetained, costBase: r.costBase, irpfSaved: range(r.irpfSaved), net: r.net }));
    data.push({ partnerName: "Conjunto (todos los socios)", billedBase: combined.billedBase, irpfRetained: combined.irpfRetained, costBase: combined.costBase, irpfSaved: range(combined.irpfSaved), net: combined.net });

    return await xlsxResponse({
      filename: `analitica-socios-${tenant.slug}-${from}-${to}.xlsx`,
      columns,
      rows: data,
      filters: [{ label: "Desde", value: from }, { label: "Hasta", value: to }, { label: "Generado", value: new Date().toLocaleString("es-ES") }],
    });
  } catch (err) {
    return serverError(err);
  }
});
