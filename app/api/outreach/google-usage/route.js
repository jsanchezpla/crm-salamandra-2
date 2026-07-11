import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";
import { googleUsageOf } from "../../../../lib/outreach/googlePlaces.js";

/**
 * GET /api/outreach/google-usage
 *
 * Uso del mes en curso de la Places API para este tenant (contador propio del
 * CRM): { month, count, limit, remaining }. Solo lectura, para pintar en la UI
 * cuántas búsquedas de Google quedan. Aplica el reset mensual sin escribir nada.
 */
export const GET = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  const { OutreachSettings } = ctx.tenantModels;
  const settings = await OutreachSettings.findOne();
  return ok(googleUsageOf(settings));
});
