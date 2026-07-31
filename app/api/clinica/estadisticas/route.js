import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, serverError } from "../../../../lib/utils/apiResponse.js";
import { calcularEstadisticas, gateEstadisticas, rangoPedido } from "../../../../lib/clinica/estadisticas.js";

/**
 * GET /api/clinica/estadisticas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * — las cifras del centro en un periodo (bloque 6 del sprint, punto 10).
 *
 * Solo dirección: son datos agregados de TODO el equipo, y el CRM ya distingue
 * entre lo que ve cada profesional y lo que ve quien dirige.
 *
 * Sin fechas, el mes en curso. El cálculo vive en `lib/clinica/estadisticas.js`
 * porque lo comparten la pantalla, el Excel y el PDF: si contase cada uno por
 * su lado, el papel de la reunión y el CRM acabarían diciendo cosas distintas.
 */

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gateEstadisticas(ctx);
    if (veto) return veto;
    const { veto: vetoRango, rango } = rangoPedido(request);
    if (vetoRango) return vetoRango;

    return ok(await calcularEstadisticas(ctx.tenantModels, rango));
  } catch (err) {
    return serverError(err);
  }
});
