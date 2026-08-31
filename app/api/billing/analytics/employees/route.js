import { fn, col, Op, literal } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { monthsBetween } from "../../../../../lib/billing/billingSummary.js";
import { activeInvoiceScope } from "../../../../../lib/billing/invoiceScope.js";
import { basePorEmpleado } from "../../../../../lib/billing/repartoPorEmpleado.js";

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

    // Ingresos por empleado (sobre base imponible). Desde el 31/08/2026 una
    // línea puede llevar SU empleado (factura con dos terapeutas): esas
    // facturas se apartan del agregado SQL y se reparten línea a línea en JS
    // (lib/billing/repartoPorEmpleado.js). El resto —la inmensa mayoría—
    // sigue sumándose en SQL como siempre.
    const scope = activeInvoiceScope(Invoice);
    const SIN_REPARTO = literal(`lines::text NOT LIKE '%"employeeId"%'`);
    const CON_REPARTO = literal(`lines::text LIKE '%"employeeId"%'`);
    const invoiceRows = await Invoice.findAll({
      where: {
        employeeId: { [Op.ne]: null },
        issueDate: { [Op.between]: [from, to] },
        status: scope.status,
        [Op.and]: [...scope[Op.and], SIN_REPARTO],
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

    // Las repartidas, una a una. Sin filtrar por employeeId de factura: una
    // factura puede repartirse entera por líneas con el campo de arriba vacío.
    const repartidas = await Invoice.findAll({
      where: {
        issueDate: { [Op.between]: [from, to] },
        status: scope.status,
        [Op.and]: [...scope[Op.and], CON_REPARTO],
      },
      attributes: ["id", "employeeId", "clientId", "lines"],
      raw: true,
    });
    // employeeId → { base, facturas, clientes } acumulado de las repartidas.
    const extra = new Map();
    for (const inv of repartidas) {
      for (const [empId, base] of basePorEmpleado(inv)) {
        const acc = extra.get(empId) ?? { base: 0, facturas: 0, clientes: new Set() };
        acc.base = round2(acc.base + base);
        acc.facturas += 1;
        if (inv.clientId) acc.clientes.add(inv.clientId);
        extra.set(empId, acc);
      }
    }

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

    // Un solo listado por empleado: el agregado SQL + su parte de las
    // repartidas. `clientCount` suma los clientes distintos de cada origen;
    // si un cliente aparece en los dos, se cuenta dos veces — es el precio de
    // no bajarse todas las facturas, y solo desvía ese contador, nunca el dinero.
    const porEmpleado = new Map(
      invoiceRows.map((r) => [r.employeeId, {
        billedBase: round2(Number(r.billedBase || 0)),
        invoiceCount: Number(r.invoiceCount || 0),
        clientCount: Number(r.clientCount || 0),
      }])
    );
    for (const [empId, acc] of extra) {
      const fila = porEmpleado.get(empId) ?? { billedBase: 0, invoiceCount: 0, clientCount: 0 };
      fila.billedBase = round2(fila.billedBase + acc.base);
      fila.invoiceCount += acc.facturas;
      fila.clientCount += acc.clientes.size;
      porEmpleado.set(empId, fila);
    }

    // Datos del empleado
    const employeeIds = [...porEmpleado.keys()];
    const employees = await TeamMember.findAll({
      where: { id: employeeIds },
      attributes: ["id", "displayName", "position", "monthlySalary"],
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const months = monthsBetween(from, to);

    const result = [...porEmpleado.entries()].map(([employeeId, fila]) => {
      const row = { employeeId };
      const emp = empMap.get(row.employeeId);
      const billedBase = fila.billedBase;
      const invoiceCount = fila.invoiceCount;
      const clientCount = fila.clientCount;
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
