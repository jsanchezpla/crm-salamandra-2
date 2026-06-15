import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError } from "../../../../lib/utils/errors.js";

/**
 * GET /api/training/sync-status
 *
 * Devuelve la última sincronización registrada en `training_sync_log` para
 * este tenant, junto con metadatos para que la UI pueda renderizar el banner
 * "última sync" en /formacion/cursos.
 *
 * Gating: `syncEnabled` se activa SOLO si existe la variable de entorno
 * `{TENANT_SLUG_UPPER}_TUTOR_SYNC_URL`. Si no está definida, la UI no debe
 * mostrar el banner — el tenant no tiene flujo de sincronización configurado.
 *
 * Para retorika:
 *   RETORIKA_TUTOR_SYNC_URL=https://asesoriaretorika.com/?retorika_sync_courses=1
 *
 * Respuesta:
 *   {
 *     tenantSlug: "retorika",
 *     syncEnabled: true,
 *     syncUrl: "https://asesoriaretorika.com/?retorika_sync_courses=1",
 *     lastSync: {
 *       lastSyncAt: "2026-06-10T12:34:56.000Z",
 *       itemsSynced: 8,
 *       itemsDeactivated: 0,
 *       source: "wp_tutor_courses"
 *     } | null
 *   }
 */
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule, slug }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingSyncLog } = tenantModels;

  const envKey = `${slug.toUpperCase()}_TUTOR_SYNC_URL`;
  const syncUrl = process.env[envKey] || null;
  const syncEnabled = !!syncUrl;

  const last = await TrainingSyncLog.findOne({
    order: [["syncedAt", "DESC"]],
  });

  return ok({
    tenantSlug: slug,
    syncEnabled,
    syncUrl,
    lastSync: last
      ? {
          lastSyncAt: last.syncedAt,
          itemsSynced: last.itemsSynced,
          itemsDeactivated: last.itemsDeactivated,
          source: last.source,
        }
      : null,
  });
});
