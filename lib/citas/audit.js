import { getMasterModels } from "../db/masterDb.js";

/**
 * Registra un evento de auditoría del módulo Citas. No lanza errores para
 * no romper la respuesta principal si la auditoría falla.
 */
export async function logCitasAudit({
  tenantId,
  userId,
  action,
  entity, // "EventType" | "Availability" | "Booking"
  entityId,
  before = null,
  after = null,
  ip = null,
}) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity,
      entityId,
      before,
      after,
      ip,
    });
  } catch {
    // silent
  }
}
