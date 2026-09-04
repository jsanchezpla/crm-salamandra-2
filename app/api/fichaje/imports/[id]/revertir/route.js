import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { revertir } from "../../../../../../lib/fichaje/importar.js";


/**
 * POST /api/fichaje/imports/[id]/revertir — deshacer un volcado ENTERO.
 *
 * Es la reparación que hace que subir el fichero equivocado no sea un drama:
 * en vez de buscar y borrar 271 filas a mano, se quita el lote. Da de baja sus
 * jornadas (baja blanda, como todo aquí) y marca el lote como deshecho.
 *
 * NO resucita el volcado anterior. Dejar el mes vacío es un estado que se ve y
 * se arregla volviendo a subir el fichero bueno; devolver por detrás unos datos
 * que alguien había sustituido sería peor, porque nadie lo habría pedido.
 */
export const POST = withTenant(async (request, ctx, { tenant, tenantModels, tenantSequelize, hasModule, user }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    // Sin puerta de rol: la llave es tener el módulo CONCEDIDO, y eso ya lo
    // cruza `hasModule` (`lib/fichaje/acceso.js`, 04/09/2026).

    const { id } = await ctx.params;

    let res;
    try {
      res = await revertir({ importId: id, tenantModels, tenantSequelize });
    } catch (e) {
      if (e.code === "no_encontrado") return notFound(e.message);
      if (e.code === "ya_revertido") return error(e.message, 422);
      throw e;
    }

    await auditar({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      action: "fichaje.volcado_deshecho",
      entity: "FichajeImport",
      entityId: id,
      after: { periodo: res.periodo, jornadasDadasDeBaja: res.bajas, correccionesArrastradas: res.correcciones },
      ...datosPeticion(request),
    });

    return ok(res);
  } catch (err) {
    return serverError(err);
  }
});
