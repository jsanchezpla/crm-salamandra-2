import { fn, col, literal, Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { activeInvoiceScope } from "../../../../../lib/billing/invoiceScope.js";

import { ATRIBUTOS_CLIENTE_FACTURA, nifDeCliente } from "../../../../../lib/billing/nifCliente.js";
/**
 * GET /api/billing/analytics/clients?from=&to=
 *
 * Por cliente, en BASE IMPONIBLE:
 *   - Facturado (taxBase), Cobrado proporcional (paid × tax_base/total),
 *     Pendiente (Facturado − Cobrado), nº facturas, ticket medio
 *   - Costes imputados al cliente (taxBase de Cost.clientId)
 *   - Margen (Facturado − costes imputados) y %
 *
 * `billedTotal` se mantiene como dato informativo (con IVA), pero no se
 * usa para Cobrado ni Pendiente.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Cost, Client } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const invRows = await Invoice.findAll({
      where: {
        issueDate: { [Op.between]: [from, to] },
        ...activeInvoiceScope(Invoice),
      },
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
      where: {
        clientId: { [Op.ne]: null },
        incurredAt: { [Op.between]: [from, to] },
      },
      attributes: ["clientId", [fn("SUM", col("tax_base")), "imputedCosts"]],
      group: ["clientId"],
      raw: true,
    });
    const costMap = new Map(costRows.map((r) => [r.clientId, round2(Number(r.imputedCosts || 0))]));

    const clientIds = invRows.map((r) => r.clientId);
    const clients = await Client.findAll({
      where: { id: clientIds },
      attributes: ATRIBUTOS_CLIENTE_FACTURA,
    });
    const cMap = new Map(clients.map((c) => [c.id, c]));

    const result = invRows.map((row) => {
      const client = cMap.get(row.clientId);
      const billedBase = round2(Number(row.billedBase || 0));
      const billedTotal = round2(Number(row.billedTotal || 0));
      const collectedBase = round2(Number(row.collectedBase || 0));
      const pendingCollection = Math.max(0, round2(billedBase - collectedBase));
      const invoiceCount = Number(row.invoiceCount || 0);
      const imputedCosts = costMap.get(row.clientId) || 0;
      const margin = round2(billedBase - imputedCosts);
      const marginPct = billedBase > 0 ? round2((margin / billedBase) * 100) : 0;

      return {
        clientId: row.clientId,
        clientName: client?.fiscalName || client?.name || "Desconocido",
        taxId: nifDeCliente(client),
        billedBase,
        billedTotal,        // con IVA, informativo
        collectedBase,      // EN BASE
        pendingCollection,  // EN BASE
        invoiceCount,
        averageTicket: invoiceCount > 0 ? round2(billedBase / invoiceCount) : 0,
        imputedCosts,
        margin,
        marginPct,
      };
    });

    // Sort post-agregación con whitelist
    const sortBy = searchParams.get("sortBy");
    const sortDir = String(searchParams.get("sortDir") || "").toLowerCase() === "asc" ? 1 : -1;
    const SORTABLE = new Set([
      "clientName", "billedBase", "billedTotal", "collectedBase",
      "pendingCollection", "imputedCosts", "margin", "marginPct",
      "invoiceCount", "averageTicket",
    ]);
    if (SORTABLE.has(sortBy)) {
      result.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        if (typeof av === "string") return av.localeCompare(bv) * sortDir;
        return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
      });
    } else {
      result.sort((a, b) => b.billedBase - a.billedBase);
    }

    return ok({ period: { from, to }, clients: result });
  } catch (err) {
    return serverError(err);
  }
});

function round2(n) { return Math.round(Number(n) * 100) / 100; }
