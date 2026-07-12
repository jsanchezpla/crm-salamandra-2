import { getMasterModels } from "../db/masterDb.js";

/**
 * Auditoría de acciones del módulo Clínica/Pacientes. Best-effort: nunca rompe la
 * request (los AuditLog viven en el schema master). Llamar DESPUÉS de la mutación.
 */
export async function logClinicaAudit({ tenantId, userId, action, entity, entityId, before = null, after = null, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId: userId || null, action, entity, entityId, before, after, ip: ip || null });
  } catch {
    /* silent */
  }
}
