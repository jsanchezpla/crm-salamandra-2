import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { TenantBillingSettings } = tenantModels;
    let row = await TenantBillingSettings.findOne();
    if (!row) {
      row = await TenantBillingSettings.create({});
    }
    return ok(row);
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { TenantBillingSettings } = tenantModels;
    const body = await request.json();

    let row = await TenantBillingSettings.findOne();
    if (!row) row = await TenantBillingSettings.create({});

    const allowed = [
      "fiscalName", "taxId", "fiscalAddress", "fiscalCity", "fiscalZip",
      "fiscalCountry", "defaultVatRate", "defaultIrpfRate", "defaultPaymentTermsDays",
      "invoiceFooterText", "logoUrl",
    ];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    // Socios del negocio: array de { id, name }
    if ("partners" in body) {
      const arr = body.partners;
      if (!Array.isArray(arr) || arr.some((p) => !p || typeof p.id !== "string" || typeof p.name !== "string")) {
        return error("partners debe ser un array de { id, name }");
      }
      updates.partners = arr;
    }

    if ("availableVatRates" in body) {
      const arr = body.availableVatRates;
      if (!Array.isArray(arr) || arr.some((v) => typeof v !== "number" || v < 0 || v > 100)) {
        return error("availableVatRates debe ser un array de números 0-100");
      }
      updates.availableVatRates = arr;
    }

    await row.update(updates);
    return ok(row);
  } catch (err) {
    return serverError(err);
  }
});
