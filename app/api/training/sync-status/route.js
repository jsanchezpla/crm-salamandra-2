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
 *   RETORIKA_TUTOR_QUIZZES_SYNC_URL=https://asesoriaretorika.com/?retorika_sync_quizzes=1
 *
 * Respuesta:
 *   {
 *     tenantSlug: "retorika",
 *     syncEnabled: true,                       // cursos
 *     syncUrl: "https://.../?retorika_sync_courses=1",
 *     quizzesSyncEnabled: true,                // cuestionarios
 *     quizzesSyncUrl: "https://.../?retorika_sync_quizzes=1",
 *     lastSync: { ... } | null
 *   }
 */
export const GET = withTenant(async (_request, _ctx, { tenantModels, hasModule, slug }) => {
  if (!hasModule("training")) throw new ForbiddenError();

  const { TrainingSyncLog } = tenantModels;

  const upper = slug.toUpperCase();
  const syncUrl = process.env[`${upper}_TUTOR_SYNC_URL`] || null;
  const quizzesSyncUrl = process.env[`${upper}_TUTOR_QUIZZES_SYNC_URL`] || null;

  const last = await TrainingSyncLog.findOne({
    order: [["syncedAt", "DESC"]],
  });

  return ok({
    tenantSlug: slug,
    syncEnabled: !!syncUrl,
    syncUrl,
    quizzesSyncEnabled: !!quizzesSyncUrl,
    quizzesSyncUrl,
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
