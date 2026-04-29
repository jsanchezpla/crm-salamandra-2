import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../lib/billing/calculateInvoice.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";

// GET /api/billing/invoices — listado paginado con filtros
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, Client, TeamMember } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("series")) where.series = searchParams.get("series");
    if (searchParams.get("from") || searchParams.get("to")) {
      where.issueDate = {};
      if (searchParams.get("from")) where.issueDate[Op.gte] = searchParams.get("from");
      if (searchParams.get("to")) where.issueDate[Op.lte] = searchParams.get("to");
    }
    const q = (searchParams.get("q") || "").trim();
    if (q) {
      where[Op.and] = [{
        [Op.or]: [
          { number: { [Op.iLike]: `%${q}%` } },
          { "$client.name$": { [Op.iLike]: `%${q}%` } },
        ],
      }];
    }

    const allowedSort = {
      number: "number",
      issueDate: "issueDate",
      status: "status",
      taxBase: "taxBase",
      total: "total",
      paidAmount: "paidAmount",
      "client.name": [{ model: Client, as: "client" }, "name"],
      "employee.displayName": [{ model: TeamMember, as: "employee" }, "displayName"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["issueDate", "DESC"], ["number", "DESC"]]
    );

    const { count, rows } = await Invoice.findAndCountAll({
      where,
      include: [
        { model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId"] },
        { model: TeamMember, as: "employee", attributes: ["id", "displayName"] },
      ],
      order,
      limit,
      offset,
    });

    return ok({ invoices: rows, total: count, page, limit });
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/invoices — crear borrador (sin asignar número)
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Invoice, TenantBillingSettings } = tenantModels;
    const body = await request.json();

    const {
      clientId,
      employeeId,
      issueDate,
      dueDate,
      lines = [],
      series = "F",
      notes,
      customFields,
    } = body;

    if (!clientId) return error("clientId es obligatorio");
    if (!issueDate) return error("issueDate es obligatorio");
    if (!Array.isArray(lines) || lines.length === 0) {
      return error("Se requiere al menos una línea");
    }

    // Aplicar defaults del tenant si la línea no trae vatRate
    const settings = await TenantBillingSettings.findOne();
    const defaultVat = settings ? Number(settings.defaultVatRate) : 21;
    const linesWithVat = lines.map((l) => ({
      ...l,
      vatRate: l.vatRate != null ? Number(l.vatRate) : defaultVat,
    }));

    const calc = calculateInvoice({ lines: linesWithVat });

    // Borrador: sin número, sin serie congelada
    const invoice = await Invoice.create({
      clientId,
      employeeId: employeeId || null,
      issueDate,
      dueDate: dueDate || null,
      lines: calc.lines,
      taxBase: calc.taxBase,
      vatAmount: calc.vatAmount,
      total: calc.total,
      paidAmount: 0,
      series,
      number: `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "draft",
      notes: notes || null,
      customFields: customFields || {},
      // legacy campos quedan a 0/null
      subtotal: calc.taxBase,
      vatRate: 0,
    });

    return created(invoice);
  } catch (err) {
    return serverError(err);
  }
});
