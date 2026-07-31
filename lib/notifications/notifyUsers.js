/**
 * Helper genérico de notificaciones in-app (campana) — sprint Aumenta
 * 2026-07-28. Hasta ahora cada módulo repetía el patrón (rescheduleRequests,
 * notificarCancelacion, support/notify); esto lo centraliza para los casos
 * nuevos SIN tocar los existentes.
 *
 * Best-effort a propósito: una notificación caída nunca debe romper la
 * operación principal (mismo criterio que el resto de la infra de campana).
 */

// Crea una notificación de campana para cada userId (master.users.id).
// Con `dedupe: true` usa findOrCreate sobre (userId, type, entityId) para no
// duplicar avisos del mismo hecho.
export async function notifyUsers({ tenantModels, userIds, type, title, body, entityType, entityId, dedupe = false }) {
  const { Notification } = tenantModels;
  if (!Notification || !Array.isArray(userIds) || userIds.length === 0) return;
  for (const userId of new Set(userIds.filter(Boolean))) {
    try {
      const values = { userId, channel: "app", type, title, body: body ?? null, entityType: entityType ?? null, entityId: entityId ?? null };
      if (dedupe && entityId) {
        await Notification.findOrCreate({ where: { userId, type, entityId }, defaults: values });
      } else {
        await Notification.create(values);
      }
    } catch {
      // best-effort
    }
  }
}
