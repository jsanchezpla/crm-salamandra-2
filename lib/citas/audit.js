import { getMasterModels } from "../db/masterDb.js";
import { ladosParaAuditar } from "./resumenDeCita.js";

/**
 * Registra un evento de auditoría del módulo Citas. No lanza errores para
 * no romper la respuesta principal si la auditoría falla.
 *
 * Con `entity: "Booking"` nunca guarda datos de contacto, texto libre ni el
 * token de cancelar, aunque quien llama se los pase (13/09/2026,
 * `resumenDeCita.js` → `ladosParaAuditar`). Motivo de tocar /lib/ (regla #2):
 * cinco llamadas y un script volcaban la cita entera en master; filtrar solo en
 * ellas deja la puerta abierta a la siguiente ruta que se olvide. Las demás
 * entidades pasan tal cual.
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
    const lados = ladosParaAuditar({ entity, before, after });
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity,
      entityId,
      before: lados.before,
      after: lados.after,
      ip,
    });
  } catch {
    // silent
  }
}
