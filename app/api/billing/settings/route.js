import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { CAMPOS_MARCA, refValidaPara } from "../../../../lib/billing/marcaImagen.js";


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

export const PUT = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { TenantBillingSettings } = tenantModels;
    const body = await request.json();

    let row = await TenantBillingSettings.findOne();
    if (!row) row = await TenantBillingSettings.create({});

    const allowed = [
      "fiscalName", "taxId", "fiscalAddress", "fiscalCity", "fiscalZip",
      "fiscalCountry", "defaultVatRate", "defaultIrpfRate", "defaultPaymentTermsDays",
      "invoiceFooterText", "logoUrl",
      // Membrete propio del presupuesto (31/08/2026); vacío = el de la factura.
      "quoteFooterText", "quoteLogoUrl",
      // El sello del centro para el PDF (31/08/2026).
      "stampUrl",
    ];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    /*
     * Las imágenes de marca subidas (07/09/2026, AV-0069): en los ajustes se
     * guarda una referencia nuestra, `/marca/<slug>/<uuid>.png`. El cerrojo va
     * AQUÍ, en la escritura, y no al leer: así el PDF puede fiarse de la fila
     * sin volver a preguntar de quién es. Una URL de internet o el campo vacío
     * pasan tal cual, que es lo de siempre.
     */
    for (const columna of Object.values(CAMPOS_MARCA)) {
      if (columna in updates && !refValidaPara(tenant.slug, updates[columna])) {
        return error("Esa imagen de marca no es de este centro", 422);
      }
    }

    // Régimen fiscal del emisor: 'company' (SL, sin IRPF) | 'autonomo' (autónomo
    // con actividad empresarial, sin IRPF) | 'freelance' (autónomo PROFESIONAL, −15%).
    if ("taxRegime" in body) {
      if (!["company", "autonomo", "freelance"].includes(body.taxRegime)) {
        return error("taxRegime debe ser 'company', 'autonomo' o 'freelance'");
      }
      updates.taxRegime = body.taxRegime;
    }

    // Exención general de IVA + su nota legal (texto libre).
    if ("vatExempt" in body) updates.vatExempt = !!body.vatExempt;
    if ("vatExemptNote" in body) {
      updates.vatExemptNote = body.vatExemptNote == null ? null : String(body.vatExemptNote).slice(0, 2000);
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
