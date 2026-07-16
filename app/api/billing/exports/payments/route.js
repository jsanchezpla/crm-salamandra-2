import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { parseSortOrder } from "@/lib/billing/parseSort.js";
import { xlsxResponse, baseUrlFrom, MONEY_FMT, fmtDateEs } from "@/lib/billing/exportXlsx.js";

const METHOD = { card: "Tarjeta", transfer: "Transferencia", cash: "Efectivo", direct_debit: "Domiciliación" };
const STATUS = { completed: "Completado", pending: "Pendiente", failed: "Fallido", refunded: "Reembolsado" };

/** GET /api/billing/exports/payments — Cobros a XLSX. 1ª columna = enlace al PDF de la factura. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");
    const method = searchParams.get("method");
    const invoiceId = searchParams.get("invoiceId");

    const where = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (status) where.status = status;
    if (method) where.method = method;
    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt[Op.gte] = `${from} 00:00:00`;
      if (to) where.paidAt[Op.lte] = `${to} 23:59:59`;
    }

    const SORT = { paidAt: "paidAt", amount: "amount", method: "method", status: "status", "invoice.number": [{ model: Invoice, as: "invoice" }, "number"] };
    const rows = await Payment.findAll({
      where,
      include: [{ model: Invoice, as: "invoice", attributes: ["id", "number", "total", "status", "clientId", "issueDate"] }],
      order: parseSortOrder(searchParams.get("sortBy"), searchParams.get("sortDir"), SORT, [["paidAt", "DESC"]]),
    });

    const base = baseUrlFrom(request);
    const columns = [
      { header: "Factura", key: "factura", width: 18, link: true },
      { header: "Método", key: "metodo", width: 16 },
      { header: "Fecha", key: "fecha", width: 14 },
      { header: "Estado", key: "estado", width: 14 },
      { header: "Importe", key: "amount", width: 14, numFmt: MONEY_FMT },
    ];
    const data = rows.map((p) => {
      const inv = p.invoice;
      const factura =
        inv && inv.id && inv.status !== "draft"
          ? { text: inv.number || "(sin nº)", hyperlink: `${base}/api/billing/invoices/${inv.id}/pdf` }
          : inv?.number || "—";
      return {
        factura,
        metodo: METHOD[p.method] ?? p.method,
        fecha: fmtDateEs(p.paidAt),
        estado: STATUS[p.status] ?? p.status,
        amount: Number(p.amount || 0),
      };
    });

    return await xlsxResponse({
      filename: `cobros-${tenant.slug}.xlsx`,
      columns,
      rows: data,
      filters: [
        { label: "Desde", value: from || "—" },
        { label: "Hasta", value: to || "—" },
        { label: "Estado", value: status ? STATUS[status] ?? status : "Todos" },
        { label: "Método", value: method ? METHOD[method] ?? method : "Todos" },
        { label: "Generado", value: new Date().toLocaleString("es-ES") },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
