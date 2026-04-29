import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { InvoiceSeries } = tenantModels;
    const series = await InvoiceSeries.findAll({ order: [["isDefault", "DESC"], ["code", "ASC"]] });
    return ok(series);
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { InvoiceSeries } = tenantModels;
    const body = await request.json();
    const { code, name, prefix, year, kind = "normal" } = body;

    if (!code || !/^[A-Z0-9]{1,8}$/.test(code)) return error("code inválido (1-8 chars A-Z/0-9)");
    if (!name) return error("name obligatorio");
    if (!year || !Number.isInteger(year)) return error("year inválido");

    const series = await InvoiceSeries.create({
      code: String(code).toUpperCase(),
      name,
      prefix: prefix || code,
      year,
      nextNumber: 1,
      isDefault: false,
      kind: ["normal", "rectificative"].includes(kind) ? kind : "normal",
    });
    return created(series);
  } catch (err) {
    return serverError(err);
  }
});
