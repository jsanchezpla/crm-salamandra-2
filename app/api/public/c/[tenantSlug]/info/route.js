import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { exigeIdentidad, urlDeAcceso } from "../../../../../../lib/citas/puertaIdentidad.js";
import {
  exigeFormularioAceptado,
  urlDelFormulario,
} from "../../../../../../lib/citas/puertaFormulario.js";

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
    // ⚠️ Desde el 05/08/2026 esto YA NO es solo cosmético. Antes el widget
    // enseñaba un cartel de «inicia sesión» que se saltaba escribiendo `?wpa=1`
    // en la URL, y el servidor no comprobaba nada. Ahora `/book` exige una
    // sesión de portal verificada cuando la puerta está encendida — lo que se
    // anuncia aquí y lo que se aplica allí es la MISMA decisión
    // (`lib/citas/puertaIdentidad.js`).
    const widgetAuth = tenant.settings?.widget?.auth || null;
    const auth = exigeIdentidad(tenant)
      ? {
          required: true,
          loginUrl: urlDeAcceso(tenant),
          registerUrl: widgetAuth?.registerUrl ?? null,
        }
      : { required: false };

    // Puerta de admisión (ver lib/citas/puertaFormulario.js). Se anuncia por
    // delante para que la persona vea el aviso ANTES de elegir hueco y rellenar
    // sus datos, en vez de chocarse al enviar. Aquí solo va que la puerta
    // existe y a dónde manda: nunca el estado de nadie —este endpoint es
    // público y anónimo—, que se resuelve por email al reservar.
    const admision = exigeFormularioAceptado(tenant)
      ? { requerida: true, urlFormulario: urlDelFormulario(tenant) }
      : { requerida: false };

    // Página de la web del cliente donde vive el portal. Con ella, a quien
    // acaba de reservar se le manda a su área privada en vez de pedirle que se
    // guarde un enlace con un identificador dentro.
    const portalUrl = tenant.settings?.citas?.portalUrl;

    return ok({
      name: tenant.name,
      slug: tenant.slug,
      admision,
      portalUrl: typeof portalUrl === "string" && portalUrl.trim() ? portalUrl.trim() : null,
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
