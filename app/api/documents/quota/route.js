import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { getTenantStorageUsage, TENANT_QUOTA_BYTES, quotaBytesDe } from "@/lib/documents/documentStorage.js";

// GET /api/documents/quota — uso de almacenamiento del tenant.
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.DOCUMENTS_AVANZADO)) return forbidden("Módulo documents no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const usedBytes = await getTenantStorageUsage(ctx.slug);
    const limitBytes = quotaBytesDe(ctx);
    const usedPercent = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
    const toMB = (b) => Math.round((b / (1024 * 1024)) * 10) / 10;

    return ok({
      usedBytes,
      limitBytes,
      usedPercent,
      usedMB: toMB(usedBytes),
      limitMB: toMB(limitBytes),
      quotaMB: toMB(limitBytes),
    });
  } catch (err) {
    return serverError(err);
  }
});
