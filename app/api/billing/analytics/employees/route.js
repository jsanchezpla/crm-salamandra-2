import { fn, col, Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { monthsBetween } from "../../../../../lib/billing/billingSummary.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/billing/analytics/employees?from=&to=
 *
 * Por empleado:
 *   - Ingresos generados (sum taxBase de sus facturas activas)
 *   - Coste salarial registrado (sum costs.taxBase con type=salary y employeeId)
 *   - Coste salarial PROYECTADO (monthlySalary × meses) — solo informativo,
 *     no se cuenta como coste real (eso ya lo hace la tabla Costes).
 *   - Margen y % sobre base imponible
 *   - Tasa de cancelación
 *
 * `monthlySalary` y `projectedSalaryCost` solo se devuelven si el solicitante
 * es admin/superadmin.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const isAdmin = ADMIN_ROLES.has(role);

    const { Invoice, Cost, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return error("Parámetros from y to obligatorios (YYYY-MM-DD)");

    // Ingresos por empleado (sobre base imponible)
    const invoiceRows = await Invoice.findAll({
      where: {
        employeeId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: { [Op.notIn]: ["draft", "cancelled", "rectified"] },
      },
      attributes: [
        "employeeId",
        [fn("SUM", col("tax_base")), "billedBase"],
        [fn("COUNT", col("id")), "invoiceCount"],
        [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"],
      ],
      group: ["employeeId"],
      raw: true,
    });

    // Cancelaciones
    const cancelledRows = await Invoice.findAll({
      where: {
        employeeId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: "cancelled",
      },
      attributes: ["employeeId", [fn("COUNT", col("id")), "cancelledCount"]],
      group: ["employeeId"],
      raw: true,
    });
    const cancelledMap = new Map(cancelledRows.map((r) => [r.employeeId, Number(r.cancelledCount || 0)]));

    // Costes salariales reales (sobre base imponible)
    const salaryRows = await Cost.findAll({
      where: {
        type: "salary",
        employeeId: { [Op.ne]: null },
        incurredAt: { [Op.between]: [from, to] },
      },
      attributes: ["employeeId", [fn("SUM", col("tax_base")), "salaryCost"]],
      group: ["employeeId"],
      raw: true,
    });
    const salaryMap = new Map(salaryRows.map((r) => [r.employeeId, round2(Number(r.salaryCost || 0))]));

    // Datos del empleado
    const employeeIds = [...new Set(invoiceRows.map((r) => r.employeeId))];
    const employees = await TeamMember.findAll({
      where: { id: employeeIds },
      attributes: ["id", "displayName", "position", "monthlySalary"],
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const months = monthsBetween(from, to);

    const result = invoiceRows.map((row) => {
      const emp = empMap.get(row.employeeId);
      const billedBase = round2(Number(row.billedBase || 0));
      const invoiceCount = Number(row.invoiceCount || 0);
      const clientCount = Number(row.clientCount || 0);
      const cancelledCount = cancelledMap.get(row.employeeId) || 0;
      const salaryCost = salaryMap.get(row.employeeId) || 0;
      const monthlySalary = emp?.monthlySalary != null ? Number(emp.monthlySalary) : null;
      const projectedSalaryCost = monthlySalary != null ? round2(monthlySalary * months) : null;

      const margin = round2(billedBase - salaryCost);
      const marginPct = billedBase > 0 ? round2((margin / billedBase) * 100) : 0;
      const cancellationRate =
        invoiceCount + cancelledCount > 0
          ? round2((cancelledCount / (invoiceCount + cancelledCount)) * 100)
          : 0;

      const out = {
        employeeId: row.employeeId,
        employeeName: emp?.displayName ?? "Desconocido",
        position: emp?.position ?? null,
        billedBase,
        invoiceCount,
        clientCount,
        averageTicket: invoiceCount > 0 ? round2(billedBase / invoiceCount) : 0,
        salaryCost,
        margin,
        marginPct,
        cancelledCount,
        cancellationRate,
      };

      if (isAdmin) {
        out.monthlySalary = monthlySalary;
        out.projectedSalaryCost = projectedSalaryCost;
      }

      return out;
    });

    // Sort post-agregación con whitelist (admin-only fields permitidos solo si isAdmin)
    const sortBy = searchParams.get("sortBy");
    const sortDir = String(searchParams.get("sortDir") || "").toLowerCase() === "asc" ? 1 : -1;
    const SORTABLE = new Set([
      "employeeName", "position", "billedBase", "invoiceCount", "clientCount",
      "averageTicket", "salaryCost", "margin", "marginPct",
      "cancelledCount", "cancellationRate",
    ]);
    if (isAdmin) {
      SORTABLE.add("monthlySalary");
      SORTABLE.add("projectedSalaryCost");
    }
    if (SORTABLE.has(sortBy)) {
      result.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string") return av.localeCompare(bv) * sortDir;
        return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
      });
    } else {
      result.sort((a, b) => b.margin - a.margin);
    }

    return ok({ period: { from, to }, employees: result });
  } catch (err) {
    return serverError(err);
  }
});

function round2(n) { return Math.round(Number(n) * 100) / 100; }
