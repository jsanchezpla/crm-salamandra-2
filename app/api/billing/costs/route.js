import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../lib/billing/audit.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../lib/utils/apiResponse.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";
import { camposGasto } from "../../../../lib/billing/camposGasto.js";
import { computeCostTotals } from "../../../../lib/billing/totalesGasto.js";

// GET /api/billing/costs
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Client, Supplier } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("type")) where.type = searchParams.get("type");
    if (searchParams.get("category")) where.category = searchParams.get("category");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("partnerId")) where.partnerId = searchParams.get("partnerId");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("supplierId")) where.supplierId = searchParams.get("supplierId");
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
      "supplier.name": [{ model: Supplier, as: "supplier" }, "name"],
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
        { model: Supplier, as: "supplier", attributes: ["id", "name"] },
      ],
      order,
    });

    return ok(costs);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/costs
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cost, TeamMember, Supplier } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const body = await request.json();

    const campos = camposGasto(body);
    const { taxBase, vatRate = 21 } = body;

    if (!campos.type) return error("type es obligatorio");
    if (!campos.category) return error("category es obligatorio");
    if (!campos.description) return error("description es obligatorio");
    if (taxBase == null || Number(taxBase) <= 0) return error("taxBase debe ser mayor que 0");
    if (!campos.incurredAt) return error("incurredAt es obligatorio (YYYY-MM-DD)");

    // El proveedor tiene que ser de ESTE tenant: `Supplier` sale de
    // `tenantModels`, así que un id de otro cliente no aparece aquí.
    if (campos.supplierId) {
      const proveedor = await Supplier.findByPk(campos.supplierId, { attributes: ["id"] });
      if (!proveedor) return notFound("Proveedor no encontrado");
    }

    const totals = computeCostTotals({ taxBase, vatRate });

    // Empleado por defecto: el TeamMember cuyo userId coincide con el del
    // solicitante. employeeId del body siempre prevalece.
    let resolvedEmployeeId = campos.employeeId || null;
    if (!resolvedEmployeeId && userId) {
      const me = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
      if (me) resolvedEmployeeId = me.id;
    }

    const cost = await Cost.create({
      ...campos,
      ...totals,
      vatDeductible: campos.vatDeductible ?? true,
      employeeId: resolvedEmployeeId,
    });

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "cost.created",
      entity: "Cost",
      entityId: cost.id,
      before: null,
      after: resumenImporte(cost),
    });
    return created(cost);
  } catch (err) {
    return serverError(err);
  }
});
