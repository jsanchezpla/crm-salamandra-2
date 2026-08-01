import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, serverError } from "../../../../lib/utils/apiResponse.js";
import { calcularEstadisticas, gateEstadisticas, rangoPedido } from "../../../../lib/leads/estadisticas.js";

/**
 * GET /api/leads/estadisticas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * — las cifras de captación: embudo de leads profesionales, bandeja de
 * comerciales y entrada por mes (01/08/2026).
 *
 * Sin fechas, los últimos 12 meses: en captación lo que se mira es la
 * tendencia, no el mes suelto.
 *
 * No es solo de dirección, a diferencia de las estadísticas del centro: esta
 * pantalla es el padre del grupo «Leads» en el menú, así que quien trabaja el
 * embudo tiene que poder abrirla.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gateEstadisticas(ctx);
    if (veto) return veto;
    const { veto: vetoRango, rango } = rangoPedido(request);
    if (vetoRango) return vetoRango;

    return ok(await calcularEstadisticas(ctx, rango));
  } catch (err) {
    return serverError(err);
  }
});
