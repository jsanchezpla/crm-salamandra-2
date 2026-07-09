import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function computeCostTotals({ taxBase, vatRate }) {
  const base = round2(Number(taxBase ?? 0));
  const rate = round2(Number(vatRate ?? 0));
  const taxAmount = round2(base * (rate / 100));
  const total = round2(base + taxAmount);
  return { taxBase: base, vatRate: rate, taxAmount, total };
}

// GET /api/billing/costs
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Client } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("type")) where.type = searchParams.get("type");
    if (searchParams.get("category")) where.category = searchParams.get("category");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("partnerId")) where.partnerId = searchParams.get("partnerId");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("from") || searchParams.get("to")) {
      where.incurredAt = {};
      if (searchParams.get("from")) where.incurredAt[Op.gte] = searchParams.get("from");
      if (searchParams.get("to")) where.incurredAt[Op.lte] = searchParams.get("to");
    }

    const allowedSort = {
      incurredAt: "incurredAt",
      type: "type",
      category: "category",
      description: "description",
      taxBase: "taxBase",
      taxAmount: "taxAmount",
      total: "total",
      "employee.displayName": [{ model: TeamMember, as: "employee" }, "displayName"],
      "client.name": [{ model: Client, as: "client" }, "name"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["incurredAt", "DESC"], ["type", "ASC"]]
    );

    const costs = await Cost.findAll({
      where,
      include: [
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
        { model: Client, as: "client", attributes: ["id", "name"] },
      ],
      order,
    });

    return ok(costs);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/costs
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const body = await request.json();

    const {
      type, category, description, taxBase, vatRate = 21, vatDeductible = true,
      incurredAt, employeeId, partnerId, clientId, inventoryProductId, attachmentUrl,
    } = body;

    if (!type) return error("type es obligatorio");
    if (!category) return error("category es obligatorio");
    if (!description) return error("description es obligatorio");
    if (taxBase == null || Number(taxBase) <= 0) return error("taxBase debe ser mayor que 0");
    if (!incurredAt) return error("incurredAt es obligatorio (YYYY-MM-DD)");

    const totals = computeCostTotals({ taxBase, vatRate });

    // Empleado por defecto: el TeamMember cuyo userId coincide con el del
    // solicitante. employeeId del body siempre prevalece.
    let resolvedEmployeeId = employeeId || null;
    if (!resolvedEmployeeId && userId) {
      const me = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
      if (me) resolvedEmployeeId = me.id;
    }

    const cost = await Cost.create({
      type,
      category,
      description,
      ...totals,
      vatDeductible: !!vatDeductible,
      incurredAt,
      employeeId: resolvedEmployeeId,
      partnerId: partnerId || null,
      clientId: clientId || null,
      inventoryProductId: inventoryProductId || null,
      attachmentUrl: attachmentUrl || null,
    });

    return created(cost);
  } catch (err) {
    return serverError(err);
  }
});
