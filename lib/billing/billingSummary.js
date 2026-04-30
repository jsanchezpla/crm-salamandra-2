import { Op, fn, col, literal } from "sequelize";
import { withEffectiveStatusList } from "./invoiceStatus.js";

/**
 * Agregados de facturación reutilizables.
 *
 * - getKpisForPeriod: KPIs del Resumen de Facturación
 * - getClientBillingSummary: facturación por cliente
 * - getEmployeeBillingSummary: facturación + costes por empleado
 *
 * Reglas conceptuales:
 *   - Magnitudes financieras (Facturado, Cobrado, Pendiente, Margen Bruto/Neto,
 *     EBITDA) usan SIEMPRE base imponible (taxBase). El IVA es dinero que pasa
 *     por la empresa pero no es suyo. Los reportes con IVA (Libro IVA, Modelo
 *     303) son responsabilidad de buildIvaReport.js.
 *   - Cobrado en base se calcula proporcionalmente: cada factura aporta
 *     paid_amount × (tax_base / total). Esto distribuye correctamente el IVA
 *     pagado fuera del importe operativo.
 *   - Pendiente = Facturado − Cobrado, ambos en base. Siempre ≥ 0.
 *   - Cobrado/Pendiente se filtran por issueDate de la factura (no por la
 *     fecha del pago). Una factura del periodo cobrada después sigue siendo
 *     "del periodo".
 *   - Estados excluidos para "Facturado": draft, cancelled, rectified.
 */

const ACTIVE_STATUSES = { [Op.notIn]: ["draft", "cancelled", "rectified"] };

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// SQL fragment reutilizable: cobrado proporcional en base imponible
//   collected_base = paid_amount × (tax_base / total)
// NULLIF evita división por cero en facturas con total = 0.
const COLLECTED_BASE_SQL = literal(
  `COALESCE(SUM(paid_amount * tax_base / NULLIF(total, 0)), 0)`
);

// ─── KPIs principales ─────────────────────────────────────────────────────

export async function getKpisForPeriod({ tenantModels, from, to }) {
  const { Invoice, Cost } = tenantModels;
  const periodWhere = { issueDate: { [Op.between]: [from, to] }, status: ACTIVE_STATUSES };

  // 1) Facturado y Cobrado en BASE IMPONIBLE
  const invoiceRows = await Invoice.findAll({
    where: periodWhere,
    attributes: [
      [fn("SUM", col("tax_base")), "billedBase"],
      [COLLECTED_BASE_SQL, "collectedBase"],
      [fn("SUM", col("total")), "billedTotal"],
      [fn("COUNT", col("id")), "invoiceCount"],
    ],
    raw: true,
  });

  const billedBase = round2(Number(invoiceRows[0]?.billedBase || 0));
  const billedTotal = round2(Number(invoiceRows[0]?.billedTotal || 0));
  const collectedBase = round2(Number(invoiceRows[0]?.collectedBase || 0));
  const invoiceCount = Number(invoiceRows[0]?.invoiceCount || 0);

  // Pendiente = Facturado − Cobrado en base. Nunca negativo.
  const pendingCollection = Math.max(0, round2(billedBase - collectedBase));
  const collectedPct = billedBase > 0 ? round2((collectedBase / billedBase) * 100) : 0;
  const averageTicket = invoiceCount > 0 ? round2(billedBase / invoiceCount) : 0;

  // Clientes únicos del periodo (todos los activos)
  const clientRows = await Invoice.findAll({
    where: periodWhere,
    attributes: [[fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"]],
    raw: true,
  });
  const clientCount = Number(clientRows[0]?.clientCount || 0);

  // Conteos SOLO de las pendientes (paid_amount < total)
  const pendingRows = await Invoice.findAll({
    where: { ...periodWhere, paidAmount: { [Op.lt]: col("total") } },
    attributes: [
      [fn("COUNT", col("id")), "pendingInvoiceCount"],
      [fn("COUNT", fn("DISTINCT", col("client_id"))), "pendingClientCount"],
    ],
    raw: true,
  });
  const pendingInvoiceCount = Number(pendingRows[0]?.pendingInvoiceCount || 0);
  const pendingClientCount = Number(pendingRows[0]?.pendingClientCount || 0);

  // 2) Costes en el periodo (taxBase) por categoría y tipo
  const costRows = await Cost.findAll({
    where: { incurredAt: { [Op.between]: [from, to] } },
    attributes: [
      [fn("SUM", col("tax_base")), "total"],
      "type",
      "category",
    ],
    group: ["type", "category"],
    raw: true,
  });

  const totalCosts = round2(costRows.reduce((s, r) => s + Number(r.total || 0), 0));
  const costByCategory = { fixed: 0, variable: 0, capex: 0, opex: 0 };
  const costByType = {};
  for (const r of costRows) {
    const v = round2(Number(r.total || 0));
    costByCategory[r.category] = round2((costByCategory[r.category] || 0) + v);
    costByType[r.type] = round2((costByType[r.type] || 0) + v);
  }
  // Operativos = todos menos CAPEX. Útil para pintar la fórmula visible.
  const operatingCosts = round2(costByCategory.variable + costByCategory.fixed + costByCategory.opex);

  // 3) Márgenes (sobre base imponible, sin IVA)
  const grossMargin = round2(billedBase - costByCategory.variable);
  const netMargin = round2(billedBase - operatingCosts);
  // EBITDA = Margen Neto + CAPEX. CAPEX no es coste operativo, es inversión.
  const ebitda = round2(netMargin + costByCategory.capex);
  const grossMarginPct = billedBase > 0 ? round2((grossMargin / billedBase) * 100) : 0;
  const netMarginPct = billedBase > 0 ? round2((netMargin / billedBase) * 100) : 0;
  const ebitdaPct = billedBase > 0 ? round2((ebitda / billedBase) * 100) : 0;

  // 4) Evolución mensual (taxBase por mes)
  const monthlyRows = await Invoice.findAll({
    where: periodWhere,
    attributes: [
      [fn("TO_CHAR", fn("DATE_TRUNC", "month", col("issue_date")), "YYYY-MM"), "month"],
      [fn("SUM", col("tax_base")), "billedBase"],
      [fn("COUNT", col("id")), "count"],
    ],
    group: [fn("DATE_TRUNC", "month", col("issue_date"))],
    order: [[fn("DATE_TRUNC", "month", col("issue_date")), "ASC"]],
    raw: true,
  });
  const byMonth = monthlyRows.map((r) => ({
    month: r.month,
    billedBase: round2(Number(r.billedBase || 0)),
    count: Number(r.count || 0),
  }));

  return {
    period: { from, to },
    income: {
      billedBase,
      billedTotal,             // total con IVA, solo informativo
      collectedBase,           // EN BASE
      pendingCollection,       // EN BASE
      collectedPct,            // sobre billedBase
      invoiceCount,            // todas las facturas activas del periodo
      clientCount,             // todos los clientes únicos
      pendingInvoiceCount,     // solo las pendientes
      pendingClientCount,      // clientes únicos de las pendientes
      averageTicket,
      byMonth,
    },
    costs: {
      total: totalCosts,
      operating: operatingCosts,
      byCategory: costByCategory,
      byType: costByType,
    },
    margins: {
      grossMargin,
      grossMarginPct,
      netMargin,
      netMarginPct,
      ebitda,
      ebitdaPct,
    },
  };
}

// ─── Por cliente ──────────────────────────────────────────────────────────

export async function getClientBillingSummary({ tenantModels, clientId, from, to }) {
  const { Invoice, Cost, Client } = tenantModels;
  const where = { clientId, status: ACTIVE_STATUSES };
  const costWhere = { clientId };
  if (from && to) {
    where.issueDate = { [Op.between]: [from, to] };
    costWhere.incurredAt = { [Op.between]: [from, to] };
  }

  const client = await Client.findByPk(clientId, { attributes: ["id", "name", "fiscalName", "taxId"] });

  const invRows = await Invoice.findAll({
    where,
    attributes: [
      [fn("SUM", col("tax_base")), "billedBase"],
      [fn("SUM", col("total")), "billedTotal"],
      [COLLECTED_BASE_SQL, "collectedBase"],
      [fn("COUNT", col("id")), "invoiceCount"],
    ],
    raw: true,
  });

  const billedBase = round2(Number(invRows[0]?.billedBase || 0));
  const billedTotal = round2(Number(invRows[0]?.billedTotal || 0));
  const collectedBase = round2(Number(invRows[0]?.collectedBase || 0));
  const invoiceCount = Number(invRows[0]?.invoiceCount || 0);
  const pendingCollection = Math.max(0, round2(billedBase - collectedBase));

  // Costes imputables a este cliente
  const costsRows = await Cost.findAll({
    where: costWhere,
    attributes: [[fn("SUM", col("tax_base")), "total"]],
    raw: true,
  });
  const imputedCosts = round2(Number(costsRows[0]?.total || 0));

  const margin = round2(billedBase - imputedCosts);
  const marginPct = billedBase > 0 ? round2((margin / billedBase) * 100) : 0;

  // Listado reciente. Necesitamos dueDate para que effectiveStatus pueda
  // calcular overdue dinámicamente al servirlas hacia el frontend.
  const invoices = await Invoice.findAll({
    where,
    attributes: ["id", "number", "issueDate", "dueDate", "status", "taxBase", "total", "paidAmount"],
    order: [["issueDate", "DESC"]],
    limit: 50,
  });

  return {
    client,
    period: { from: from ?? null, to: to ?? null },
    billedBase,
    billedTotal,
    collectedBase,        // EN BASE (antes era collectedTotal con IVA)
    pendingCollection,    // EN BASE
    invoiceCount,
    imputedCosts,
    margin,
    marginPct,
    invoices: withEffectiveStatusList(invoices),
  };
}

// ─── Por empleado ─────────────────────────────────────────────────────────

export async function getEmployeeBillingSummary({ tenantModels, employeeId, from, to }) {
  const { Invoice, Cost, TeamMember } = tenantModels;
  const periodWhere = from && to ? { [Op.between]: [from, to] } : undefined;

  const employee = await TeamMember.findByPk(employeeId, {
    attributes: ["id", "displayName", "position", "department", "monthlySalary"],
  });

  const invWhere = { employeeId, status: ACTIVE_STATUSES };
  if (periodWhere) invWhere.issueDate = periodWhere;

  const invRows = await Invoice.findAll({
    where: invWhere,
    attributes: [
      [fn("SUM", col("tax_base")), "billedBase"],
      [fn("COUNT", col("id")), "invoiceCount"],
      [fn("COUNT", fn("DISTINCT", col("client_id"))), "clientCount"],
    ],
    raw: true,
  });
  const billedBase = round2(Number(invRows[0]?.billedBase || 0));
  const invoiceCount = Number(invRows[0]?.invoiceCount || 0);
  const clientCount = Number(invRows[0]?.clientCount || 0);

  // Costes registrados por este empleado (employeeId)
  const costWhere = { employeeId };
  if (periodWhere) costWhere.incurredAt = periodWhere;
  const costRows = await Cost.findAll({
    where: costWhere,
    attributes: [
      [fn("SUM", col("tax_base")), "total"],
      "type",
    ],
    group: ["type"],
    raw: true,
  });
  const costByType = {};
  let costTotal = 0;
  for (const r of costRows) {
    const v = round2(Number(r.total || 0));
    costByType[r.type] = v;
    costTotal = round2(costTotal + v);
  }

  // Coste salarial PROYECTADO para el periodo desde monthlySalary
  // Solo informativo. NO se cuenta como coste real (eso lo hace la tabla Costes).
  let projectedSalaryCost = 0;
  if (employee?.monthlySalary != null && from && to) {
    const months = monthsBetween(from, to);
    projectedSalaryCost = round2(Number(employee.monthlySalary) * months);
  }

  return {
    employee: employee ? {
      id: employee.id,
      displayName: employee.displayName,
      position: employee.position,
      department: employee.department,
      monthlySalary: employee.monthlySalary != null ? Number(employee.monthlySalary) : null,
    } : null,
    period: { from: from ?? null, to: to ?? null },
    billedBase,
    invoiceCount,
    clientCount,
    averageTicket: invoiceCount > 0 ? round2(billedBase / invoiceCount) : 0,
    costTotal,
    costByType,
    projectedSalaryCost,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Devuelve el número de meses (con decimales) entre dos fechas,
 * usando la duración promedio de un mes (30.4375 días).
 *
 * Antes la fórmula era inclusiva por meses naturales (+1) y daba 13 meses
 * para un periodo de 365 días. Esto inflaba projectedSalaryCost ~8% y era
 * contraintuitivo. Ahora un periodo de 1 año natural devuelve ~12.0 meses.
 */
export function monthsBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const days = (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, round2(days / 30.4375));
}
