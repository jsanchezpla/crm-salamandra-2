import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { exigeIdentidad, urlDeAcceso } from "../../../../../../lib/citas/puertaIdentidad.js";
import {
  exigeFormularioAceptado,
  urlDelFormulario,
} from "../../../../../../lib/citas/puertaFormulario.js";
import { exigeFormularioParaValoracion } from "../../../../../../lib/citas/puertaValoracion.js";
import {
  reservaOnlineCerrada,
  mensajeReservaCerrada,
  urlDeContacto,
} from "../../../../../../lib/citas/puertaReserva.js";

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

    // Lo mismo, pero solo para la PRIMERA visita (05/08/2026). Se anuncia
    // aparte de `admision` porque son dos puertas distintas: aquella vale para
    // todas las citas y esta solo para la valoración inicial, que es la que
    // trae a quien el centro todavía no conoce.
    //
    // Sin esto, el botón «vengo a una valoración» del portal no tendría forma
    // de saber que hay un formulario delante, y llevaría a la persona a elegir
    // hueco, rellenar sus datos y chocarse con un 403 al final. Va aquí y no
    // dentro de `admision` para no cambiar lo que ya leen las pantallas.
    const valoracion = exigeFormularioParaValoracion(tenant)
      ? { requiereFormulario: true, urlFormulario: urlDelFormulario(tenant) }
      : { requiereFormulario: false };

    // Página de la web del cliente donde vive el portal. Con ella, a quien
    // acaba de reservar se le manda a su área privada en vez de pedirle que se
    // guarde un enlace con un identificador dentro.
    const portalUrl = tenant.settings?.citas?.portalUrl;
    // Página de reservas de su web: a donde mandar a quien abra un enlace de
    // cita única fuera del sitio del centro (ver el widget).
    const reservaUrl = tenant.settings?.citas?.reservaUrl;

    return ok({
      name: tenant.name,
      slug: tenant.slug,
      admision,
      valoracion,
      /*
       * Centro que no da cita por internet (08/08/2026).
       *
       * Se anuncia AQUÍ porque la agenda es una pantalla de navegador y no
       * puede consultar la base de datos por su cuenta: `/info` es lo primero
       * que pide, así que es lo único que le permite cortarse ANTES de pedir
       * el catálogo y el calendario. Los cuatro endpoints lo comprueban de
       * todos modos por su cuenta; esto es para que la persona vea un mensaje
       * en vez de una agenda vacía.
       */
      reserva: reservaOnlineCerrada(tenant)
        ? {
            cerrada: true,
            mensaje: mensajeReservaCerrada(tenant),
            urlContacto: urlDeContacto(tenant),
          }
        : { cerrada: false },
      portalUrl: typeof portalUrl === "string" && portalUrl.trim() ? portalUrl.trim() : null,
      reservaUrl: typeof reservaUrl === "string" && reservaUrl.trim() ? reservaUrl.trim() : null,
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
