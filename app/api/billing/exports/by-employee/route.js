import { fn, col, Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { monthsBetween } from "@/lib/billing/billingSummary.js";
import { xlsxResponse, MONEY_FMT, PCT_FMT, INT_FMT } from "@/lib/billing/exportXlsx.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** GET /api/billing/exports/by-employee?from&to — Analítica por empleado a XLSX. */
export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const isAdmin = ADMIN_ROLES.has(request.headers.get("x-user-role"));
    const { Invoice, Cost, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    const invoiceRows = await Invoice.findAll({
      where: { employeeId: { [Op.ne]: null }, issueDate: { [Op.between]: [from, to] }, status: { [Op.notIn]: ["draft", "cancelled", "rectified"] } },
      attributes: ["employeeId", [fn("SUM", col("tax_base")), "billedBase"], [fn("COUNT", col("id")), "invoiceCount"], [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"]],
      group: ["employeeId"],
      raw: true,
    });
    const cancelledRows = await Invoice.findAll({
      where: { employeeId: { [Op.ne]: null }, issueDate: { [Op.between]: [from, to] }, status: "cancelled" },
      attributes: ["employeeId", [fn("COUNT", col("id")), "cancelledCount"]],
      group: ["employeeId"],
      raw: true,
    });
    const cancelledMap = new Map(cancelledRows.map((r) => [r.employeeId, Number(r.cancelledCount || 0)]));
    const salaryRows = await Cost.findAll({
      where: { type: "salary", employeeId: { [Op.ne]: null }, incurredAt: { [Op.between]: [from, to] } },
      attributes: ["employeeId", [fn("SUM", col("tax_base")), "salaryCost"]],
      group: ["employeeId"],
      raw: true,
    });
    const salaryMap = new Map(salaryRows.map((r) => [r.employeeId, round2(Number(r.salaryCost || 0))]));
    const employees = await TeamMember.findAll({ where: { id: [...new Set(invoiceRows.map((r) => r.employeeId))] }, attributes: ["id", "displayName", "position", "monthlySalary"] });
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const months = monthsBetween(from, to);

    const result = invoiceRows.map((row) => {
      const emp = empMap.get(row.employeeId);
      const billedBase = round2(Number(row.billedBase || 0));
      const invoiceCount = Number(row.invoiceCount || 0);
      const cancelledCount = cancelledMap.get(row.employeeId) || 0;
      const salaryCost = salaryMap.get(row.employeeId) || 0;
      const monthlySalary = emp?.monthlySalary != null ? Number(emp.monthlySalary) : null;
      const margin = round2(billedBase - salaryCost);
      const out = {
        employeeName: emp?.displayName ?? "Desconocido",
        position: emp?.position ?? "—",
        billedBase, invoiceCount,
        averageTicket: invoiceCount > 0 ? round2(billedBase / invoiceCount) : 0,
        salaryCost, margin,
        marginPct: billedBase > 0 ? round2((margin / billedBase) * 100) : 0,
        cancelledCount,
        cancellationRate: invoiceCount + cancelledCount > 0 ? round2((cancelledCount / (invoiceCount + cancelledCount)) * 100) : 0,
      };
      if (isAdmin) out.projectedSalaryCost = monthlySalary != null ? round2(monthlySalary * months) : null;
      return out;
    });

    const sortBy = searchParams.get("sortBy");
    const sortDir = String(searchParams.get("sortDir") || "").toLowerCase() === "asc" ? 1 : -1;
    const SORTABLE = new Set(["employeeName", "position", "billedBase", "invoiceCount", "averageTicket", "salaryCost", "margin", "marginPct", "cancelledCount", "cancellationRate"]);
    if (isAdmin) SORTABLE.add("projectedSalaryCost");
    if (SORTABLE.has(sortBy)) {
      result.sort((a, b) => { const av = a[sortBy], bv = b[sortBy]; if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return typeof av === "string" ? av.localeCompare(bv) * sortDir : ((Number(av) || 0) - (Number(bv) || 0)) * sortDir; });
    } else {
      result.sort((a, b) => b.margin - a.margin);
    }

    const columns = [
      { header: "Empleado", key: "employeeName", width: 24 },
      { header: "Rol", key: "position", width: 18 },
      { header: "Facturado (base)", key: "billedBase", width: 15, numFmt: MONEY_FMT },
      { header: "Facturas", key: "invoiceCount", width: 10, numFmt: INT_FMT },
      { header: "Ticket medio", key: "averageTicket", width: 14, numFmt: MONEY_FMT },
      { header: "Coste salarial", key: "salaryCost", width: 14, numFmt: MONEY_FMT },
      ...(isAdmin ? [{ header: "Salario proyect.", key: "projectedSalaryCost", width: 15, numFmt: MONEY_FMT }] : []),
      { header: "Margen", key: "margin", width: 14, numFmt: MONEY_FMT },
      { header: "% Margen", key: "marginPct", width: 11, numFmt: PCT_FMT },
      { header: "Cancelaciones", key: "cancelledCount", width: 12, numFmt: INT_FMT },
      { header: "% Cancelación", key: "cancellationRate", width: 13, numFmt: PCT_FMT },
    ];

    return await xlsxResponse({
      filename: `analitica-empleados-${tenant.slug}-${from}-${to}.xlsx`,
      columns,
      rows: result,
      filters: [{ label: "Desde", value: from }, { label: "Hasta", value: to }, { label: "Generado", value: new Date().toLocaleString("es-ES") }],
    });
  } catch (err) {
    return serverError(err);
  }
});
