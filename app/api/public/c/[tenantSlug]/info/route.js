import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";

/**
 * GET /api/public/c/[tenantSlug]/info
 *
 * Devuelve el mínimo de información del tenant para que la landing pinte el
 * header (nombre + branding). No expone datos sensibles del tenant.
 */
export const GET = withPublicTenant(async (_request, _ctx, { tenant, brand, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    // Gate opcional de WordPress: si el tenant tiene
    // settings.widget.auth.required = true, el widget pedirá ?wpa=1 en la URL
    // (lo añade WP cuando el usuario está logueado). loginUrl/registerUrl se
    // usan para los CTAs del aviso.
    const widgetAuth = tenant.settings?.widget?.auth || null;
    const auth = widgetAuth?.required
      ? {
          required: true,
          loginUrl: widgetAuth.loginUrl ?? null,
          registerUrl: widgetAuth.registerUrl ?? null,
        }
      : { required: false };

    return ok({
      name: tenant.name,
      slug: tenant.slug,
      brand: {
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        accentColor: brand.accentColor ?? null,
        logoUrl: brand.logoUrl ?? null,
      },
      auth,
    });
  } catch (err) {
    return serverError(err);
  }
});
