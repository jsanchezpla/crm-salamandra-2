import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, serverError } from "../../../../lib/utils/apiResponse.js";
import { rangoPedido } from "../../../../lib/utils/rangoFechas.js";
import {
  calcularEstadisticasProductos,
  gateEstadisticasProductos,
} from "../../../../lib/productos/estadisticas.js";

/**
 * GET /api/productos/estadisticas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * — las ventas del catálogo en un periodo (Productos avanzado, 03/09/2026).
 *
 * Solo dirección: son cifras de dinero de todo el centro. Sin fechas, el mes
 * en curso. El cálculo vive en `lib/productos/estadisticas.js`, con su prueba.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gateEstadisticasProductos(ctx);
    if (veto) return veto;
    const { veto: vetoRango, rango } = rangoPedido(request);
    if (vetoRango) return vetoRango;

    return ok(await calcularEstadisticasProductos(ctx.tenantModels, rango));
  } catch (err) {
    return serverError(err);
  }
});
