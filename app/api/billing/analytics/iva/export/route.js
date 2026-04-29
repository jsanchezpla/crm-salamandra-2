import ExcelJS from "exceljs";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { buildIvaReport } from "../../../../../../lib/billing/buildIvaReport.js";

/**
 * GET /api/billing/analytics/iva/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Genera un Excel con tres hojas:
 *   - "IVA Repercutido"  (ventas)
 *   - "IVA Soportado"    (compras deducibles)
 *   - "Modelo 303"       (resumen agregado)
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const report = await buildIvaReport({ tenantModels, from, to });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Salamandra CRM";
    wb.created = new Date();

    // Hoja 1: IVA Repercutido
    const out = wb.addWorksheet("IVA Repercutido");
    out.columns = [
      { header: "Fecha", key: "issueDate", width: 12 },
      { header: "Nº Factura", key: "number", width: 16 },
      { header: "Cliente", key: "clientName", width: 32 },
      { header: "NIF/CIF", key: "clientTaxId", width: 14 },
      { header: "Base imponible", key: "base", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "% IVA", key: "vatRates", width: 10 },
      { header: "Cuota IVA", key: "vat", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "Total", key: "total", width: 14, style: { numFmt: "#,##0.00" } },
    ];
    for (const inv of report.output.invoices) {
      const rates = (inv.lines || []).map((l) => Number(l.vatRate)).filter((v, i, a) => a.indexOf(v) === i).join(" / ");
      out.addRow({
        issueDate: inv.issueDate,
        number: inv.number,
        clientName: inv.clientName ?? "",
        clientTaxId: inv.clientTaxId ?? "",
        base: Number(inv.base),
        vatRates: rates,
        vat: Number(inv.vat),
        total: Number(inv.total),
      });
    }
    // Totales
    out.addRow({});
    out.addRow({
      number: "TOTAL",
      base: Number(report.output.totals.base),
      vat: Number(report.output.totals.vat),
      total: Number(report.output.totals.base + report.output.totals.vat),
    }).font = { bold: true };
    out.getRow(1).font = { bold: true };

    // Hoja 2: IVA Soportado
    const inSheet = wb.addWorksheet("IVA Soportado");
    inSheet.columns = [
      { header: "Fecha", key: "incurredAt", width: 12 },
      { header: "Descripción", key: "description", width: 40 },
      { header: "% IVA", key: "vatRate", width: 10 },
      { header: "Base imponible", key: "taxBase", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "Cuota IVA", key: "vatAmount", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "Total", key: "total", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "Deducible", key: "vatDeductible", width: 12 },
    ];
    for (const c of report.input.costs) {
      inSheet.addRow({
        incurredAt: c.incurredAt,
        description: c.description ?? "",
        vatRate: Number(c.vatRate),
        taxBase: Number(c.taxBase),
        vatAmount: Number(c.vatAmount),
        total: Number(c.total),
        vatDeductible: c.vatDeductible ? "Sí" : "No",
      });
    }
    inSheet.addRow({});
    inSheet.addRow({
      description: "TOTAL DEDUCIBLE",
      taxBase: Number(report.input.totals.base),
      vatAmount: Number(report.input.totals.vat),
      total: Number(report.input.totals.base + report.input.totals.vat),
    }).font = { bold: true };
    inSheet.getRow(1).font = { bold: true };

    // Hoja 3: Modelo 303
    const m303 = wb.addWorksheet("Modelo 303");
    m303.columns = [
      { header: "Concepto", key: "concept", width: 40 },
      { header: "Importe", key: "amount", width: 18, style: { numFmt: "#,##0.00" } },
    ];
    m303.addRow({ concept: "Periodo", amount: `${report.period.from} → ${report.period.to}` });
    m303.addRow({});
    m303.addRow({ concept: "IVA repercutido (ventas)", amount: report.model303.outputVat });
    m303.addRow({ concept: "IVA soportado deducible (compras)", amount: report.model303.deductibleInputVat });
    const diffRow = m303.addRow({
      concept: report.model303.difference >= 0 ? "A pagar a Hacienda" : "A devolver / compensar",
      amount: Math.abs(report.model303.difference),
    });
    diffRow.font = { bold: true };
    m303.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `libro-iva-${tenant.slug}-${from}-${to}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
