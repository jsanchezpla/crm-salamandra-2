import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { MODULE_KEYS } from "../../../../lib/tenant/moduleKeys.js";
import { FORM_SLUG } from "../../../../lib/formularios/registroWeb.js";

/**
 * GET /api/clients/wp-sync
 *
 * Le dice a la pantalla de Clientes si este tenant tiene puesta al día de
 * usuarios de WordPress y, si la tiene, cuántas solicitudes hay esperando.
 *
 * MISMA CONVENCIÓN que el banner de Formación (`/api/training/sync-status`):
 * la URL vive en una variable de entorno por tenant y NO en el código, porque
 * es propia de cada WordPress. Sin la variable, la pantalla no enseña nada — un
 * tenant sin web conectada no debe ver un botón que no lleva a ninguna parte.
 *
 *   {TENANT_SLUG_UPPER}_WP_USERS_SYNC_URL=https://tunutrilaura.com/?nutrilaura_sync_usuarios=1
 *
 * Respuesta: { enabled, url, pendientes }
 *   `pendientes` = solicitudes de "Alta desde la web" sin resolver, que es lo
 *   que de verdad le interesa a quien mira: cuánta gente de la web está
 *   esperando una decisión.
 */
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule, slug }) => {
  try {
    if (!hasModule("clients")) return forbidden("Módulo clients no activo");

    const url = process.env[`${slug.toUpperCase()}_WP_USERS_SYNC_URL`] || null;
    if (!url) return ok({ enabled: false, url: null, pendientes: 0 });

    // El módulo formularios puede no estar activo aunque sí lo esté clients.
    // Y el contador es un extra: si la tabla no está migrada en ese schema, el
    // botón tiene que seguir saliendo (que es lo que de verdad hace falta), no
    // desaparecer por no poder pintar un número.
    let pendientes = 0;
    const { FormSubmission } = tenantModels;
    if (FormSubmission && hasModule(MODULE_KEYS.FORMULARIOS)) {
      try {
        pendientes = await FormSubmission.count({
          where: { formSlug: FORM_SLUG, status: "pending" },
        });
      } catch {
        pendientes = 0;
      }
    }

    return ok({ enabled: true, url, pendientes });
  } catch (err) {
    return serverError(err);
  }
});
