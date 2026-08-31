import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { listaDeAcciones } from "../../../../lib/billing/accionesRequeridas.js";
import { madridToday } from "../../../../lib/utils/madridDate.js";

/**
 * GET /api/billing/acciones — las filas de la pantalla «Acciones requeridas».
 *
 * Los contadores del Panel (`/api/billing/operations`) dicen CUÁNTAS; esto dice
 * CUÁLES, con los mismos criterios (ver lib/billing/accionesRequeridas.js).
 * Solo lectura: no acepta parámetros — el filtrado por tipo lo hace la
 * pantalla encima de las tres listas, que ya vienen acotadas.
 */
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    // El día en MADRID, no en UTC, y los 7 días como CALENDARIO — el mismo
    // cuidado (y por los mismos sustos) que en operations/route.js.
    const today = madridToday();
    const [aa, mm, dd] = today.split("-").map(Number);
    const in7 = new Date(Date.UTC(aa, mm - 1, dd + 7)).toISOString().slice(0, 10);

    const data = await listaDeAcciones({ tenantModels, today, in7 });
    return ok({ today, in7, ...data });
  } catch (err) {
    return serverError(err);
  }
});
