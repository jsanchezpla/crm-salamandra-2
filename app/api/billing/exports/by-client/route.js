import { fn, col, literal, Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { xlsxResponse, MONEY_FMT, PCT_FMT, INT_FMT } from "@/lib/billing/exportXlsx.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** GET /api/billing/exports/by-client?from&to — Analítica por cliente a XLSX. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Cost, Client } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const invRows = await Invoice.findAll({
      where: { issueDate: { [Op.between]: [from, to] }, status: { [Op.notIn]: ["draft", "cancelled", "rectified"] } },
      attributes: [
        "clientId",
        [fn("SUM", col("tax_base")), "billedBase"],
        [fn("SUM", col("total")), "billedTotal"],
        [literal(`COALESCE(SUM(paid_amount * tax_base / NULLIF(total, 0)), 0)`), "collectedBase"],
        [fn("COUNT", col("id")), "invoiceCount"],
      ],
      group: ["clientId"],
      raw: true,
    });
    const costRows = await Cost.findAll({
      where: { clientId: { [Op.ne]: null }, incurredAt: { [Op.between]: [from, to] } },
      attributes: ["clientId", [fn("SUM", col("tax_base")), "imputedCosts"]],
      group: ["clientId"],
      raw: true,
    });
    const costMap = new Map(costRows.map((r) => [r.clientId, round2(Number(r.imputedCosts || 0))]));
    const clients = await Client.findAll({ where: { id: invRows.map((r) => r.clientId) }, attributes: ["id", "name", "fiscalName", "taxId"] });
    const cMap = new Map(clients.map((c) => [c.id, c]));

    const result = invRows.map((row) => {
      const client = cMap.get(row.clientId);
      const billedBase = round2(Number(row.billedBase || 0));
      const collectedBase = round2(Number(row.collectedBase || 0));
      const pendingCollection = Math.max(0, round2(billedBase - collectedBase));
      const invoiceCount = Number(row.invoiceCount || 0);
      const imputedCosts = costMap.get(row.clientId) || 0;
      const margin = round2(billedBase - imputedCosts);
      return {
        clientName: client?.fiscalName || client?.name || "Desconocido",
        taxId: client?.taxId ?? null,
        billedBase, collectedBase, pendingCollection, invoiceCount, imputedCosts, margin,
        marginPct: billedBase > 0 ? round2((margin / billedBase) * 100) : 0,
      };
    });

    const sortBy = searchParams.get("sortBy");
    const sortDir = String(searchParams.get("sortDir") || "").toLowerCase() === "asc" ? 1 : -1;
    const SORTABLE = new Set(["clientName", "billedBase", "collectedBase", "pendingCollection", "imputedCosts", "margin", "marginPct", "invoiceCount"]);
    if (SORTABLE.has(sortBy)) {
      result.sort((a, b) => (typeof a[sortBy] === "string" ? a[sortBy].localeCompare(b[sortBy]) * sortDir : ((Number(a[sortBy]) || 0) - (Number(b[sortBy]) || 0)) * sortDir));
    } else {
      result.sort((a, b) => b.billedBase - a.billedBase);
    }

    const columns = [
      { header: "Cliente", key: "clientName", width: 30 },
      { header: "NIF/CIF", key: "taxId", width: 14 },
      { header: "Facturado", key: "billedBase", width: 14, numFmt: MONEY_FMT },
      { header: "Cobrado", key: "collectedBase", width: 14, numFmt: MONEY_FMT },
      { header: "Pendiente", key: "pendingCollection", width: 14, numFmt: MONEY_FMT },
      { header: "Costes imp.", key: "imputedCosts", width: 14, numFmt: MONEY_FMT },
      { header: "Margen", key: "margin", width: 14, numFmt: MONEY_FMT },
      { header: "Margen %", key: "marginPct", width: 11, numFmt: PCT_FMT },
      { header: "Nº fact.", key: "invoiceCount", width: 10, numFmt: INT_FMT },
    ];
    const data = result.map((r) => ({ ...r, taxId: r.taxId ?? "—" }));

    return await xlsxResponse({
      filename: `analitica-clientes-${tenant.slug}-${from}-${to}.xlsx`,
      columns,
      rows: data,
      filters: [
        { label: "Desde", value: from },
        { label: "Hasta", value: to },
        { label: "Generado", value: new Date().toLocaleString("es-ES") },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
