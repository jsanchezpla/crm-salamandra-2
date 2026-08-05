import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { sincronizarDesdeWordpress } from "../../../../lib/training/syncWordpress.js";
import { assertNotDemoPaidCall } from "../../../../lib/demo/isDemo.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/training/sync — «Sincronizar con la web» (05/08/2026, Rodrigo).
 *
 * Le pide al WordPress del cliente que mande TODOS sus cursos y matrículas.
 *
 * No hacía falta para el día a día —publicar un curso o matricular a alguien ya
 * avisa solo— sino para PONERSE AL DÍA: recuperar lo que se perdió mientras el
 * puente estuvo roto. Eso solo se podía hacer abriendo dos URLs en WordPress
 * estando logueada como administradora allí; ahora es un botón.
 *
 * El registro de «última sincronización» NO se escribe aquí: lo escribe el
 * webhook `tutorlms/sync-courses` cuando WordPress entrega los cursos, que es
 * quien sabe de verdad cuántos han entrado. Duplicarlo aquí daría dos fuentes
 * para el mismo dato y acabarían discrepando.
 *
 * Puede tardar: recorre toda la web. La pantalla tiene que enseñar que está
 * trabajando en vez de dar por muerta la petición.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export const POST = withTenant(async (request, _ctx, tenantContext) => {
  try {
    const { tenant, tenantModels, hasModule } = tenantContext;
    if (!hasModule("training")) return forbidden("Módulo formación no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede sincronizar");

    // La demo da sesión de admin a cualquiera: sin esto, un visitante podría
    // usar el CRM para lanzar trabajo pesado contra el WordPress de un tercero.
    assertNotDemoPaidCall(tenantContext, "La sincronización");

    const res = await sincronizarDesdeWordpress(tenant, tenantModels);

    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: tenant.id,
      userId,
      action: res.ok ? "training.sync_manual" : "training.sync_manual_fallida",
      entity: "Training",
      entityId: null,
      before: null,
      after: { motivo: res.motivo ?? null, cursos: res.cursos ?? null, matriculas: res.matriculas ?? null },
      ip,
    });

    // Un fallo de la web NO es un 500 nuestro: 200 con el motivo en cristiano,
    // para que la pantalla pueda contarlo («la web no responde», «todavía no
    // tiene la versión del tema que hace falta»).
    return ok(res);
  } catch (err) {
    return serverError(err);
  }
});
