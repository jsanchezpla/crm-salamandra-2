import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { parseSortOrder } from "../../../../lib/billing/parseSort.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// GET /api/billing/recurring
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { RecurringInvoice, Client } = tenantModels;
    const { searchParams } = new URL(request.url);

    const where = {};
    if (searchParams.get("active") !== null) {
      where.active = searchParams.get("active") !== "false";
    }
    if (searchParams.get("clientId")) where.clientId = searchParams.get("clientId");

    const allowedSort = {
      nextRunAt: "nextRunAt",
      frequency: "frequency",
      active: "active",
      "client.name": [{ model: Client, as: "client" }, "name"],
    };
    const order = parseSortOrder(
      searchParams.get("sortBy"),
      searchParams.get("sortDir"),
      allowedSort,
      [["nextRunAt", "ASC"]]
    );

    const rows = await RecurringInvoice.findAll({
      where,
      include: [{ model: Client, as: "client", attributes: ["id", "name"] }],
      order,
    });

    return ok(rows);
  } catch (err) {
    return serverError(err);
  }
});

// POST /api/billing/recurring
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo administradores pueden gestionar facturas recurrentes");

    const { RecurringInvoice } = tenantModels;
    const body = await request.json();

    const { clientId, familyId, frequency, nextRunAt, templateConfig } = body;

    if (!clientId) return error("clientId es obligatorio");
    if (!frequency) return error("frequency es obligatorio");
    if (!nextRunAt) return error("nextRunAt es obligatorio");

    const recurring = await RecurringInvoice.create({
      clientId,
      familyId: familyId || null,
      frequency,
      nextRunAt,
      templateConfig: templateConfig || {},
      active: true,
    });

    return created(recurring);
  } catch (err) {
    return serverError(err);
  }
});
