import { getTenantContext } from "./tenantResolver.js";
import { handleRouteError } from "../utils/errors.js";

/**
 * Wrapper para Route Handlers que inyecta el contexto de tenant automáticamente.
 *
 * Uso:
 *   export const GET = withTenant(async (request, routeContext, tenantContext) => {
 *     const { tenantModels, hasModule } = tenantContext;
 *     ...
 *   });
 */
export function withTenant(handler) {
  return async function (request, routeContext) {
    try {
      const tenantContext = await getTenantContext(request);
      return await handler(request, routeContext, tenantContext);
    } catch (err) {
      return handleRouteError(err);
    }
  };
}
