import { getMasterModels } from "../db/masterDb.js";

/**
 * Registra un evento de auditoría del módulo Training en master.audit_logs.
 * No lanza errores: si la escritura falla, lo trágamos y logueamos a stderr
 * — el flujo de negocio nunca debe romperse por una auditoría caída.
 *
 * El modelo AuditLog tiene columnas: tenantId, userId, action, entity,
 * entityId, before, after (JSONB), ip. No hay columna `metadata` dedicada,
 * así que el objeto `metadata` se guarda dentro del JSONB `after`. Esto
 * mantiene el modelo intacto sin migración de master.
 *
 * Convención de `action`: "training.<entity>.<verb>".
 *   - training.course_registration.created
 *   - training.course_registration.deleted (futuro)
 *
 * Ejemplo:
 *   await logTrainingAudit({
 *     tenantId: ctx.tenant.id,
 *     action: "training.course_registration.created",
 *     entityType: "CourseRegistration",
 *     entityId: row.id,
 *     metadata: { authMode: "browser", origin: "asesoriaretorika.com" },
 *     ip,
 *   });
 */
export async function logTrainingAudit({
  tenantId = null,
  userId = null,
  action,
  entityType = null,
  entityId = null,
  metadata = null,
  ip = null,
} = {}) {
  if (!action) {
    process.stderr.write("[training:audit] action missing — skipped\n");
    return;
  }
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity: entityType,
      entityId: entityId == null ? null : String(entityId),
      before: null,
      after: metadata ?? null,
      ip,
    });
  } catch (err) {
    process.stderr.write(`[training:audit] write failed (${action}): ${err.message}\n`);
  }
}
