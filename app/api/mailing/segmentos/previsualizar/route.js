import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { exigirMailing, leerBody } from "../../../../../lib/mailing/comun.js";
import { contarAudiencia } from "../../../../../lib/mailing/audiencia.js";

/**
 * POST /api/mailing/segmentos/previsualizar — cuánta gente cae en unas reglas
 * ANTES de guardar el segmento. Mismo cálculo que el envío.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  return ok(await contarAudiencia(ctx, body.reglas ?? {}, { conClientes: ctx.tenantHasModule("clients") }));
});
