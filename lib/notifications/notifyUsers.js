/**
 * Helper genérico de notificaciones in-app (campana) — sprint Aumenta
 * 2026-07-28. Hasta ahora cada módulo repetía el patrón (rescheduleRequests,
 * notificarCancelacion, support/notify); esto lo centraliza para los casos
 * nuevos SIN tocar los existentes.
 *
 * Best-effort a propósito: una notificación caída nunca debe romper la
 * operación principal (mismo criterio que el resto de la infra de campana).
 */

/**
 * Lo mismo, pero resolviendo solo los destinatarios: los ADMIN del tenant.
 *
 * Existe porque los tres sitios que ya notificaban repetían la misma consulta a
 * `master.users`, y cada aviso nuevo la volvía a copiar. Quien tiene que
 * enterarse de que ha entrado una solicitud es quien puede atenderla.
 *
 * Best-effort como el resto: si no se puede leer la lista de admins, no se avisa
 * a nadie pero NO se rompe la operación que lo disparó. Una campana caída no
 * puede impedir que alguien reserve una cita.
 */
export async function notifyAdmins({ tenantId, tenantModels, ...resto }) {
  try {
    const { getMasterModels } = await import("../db/masterDb.js");
    const { User } = getMasterModels();
    const admins = await User.findAll({
      where: { tenantId, role: "admin" },
      attributes: ["id"],
    });
    if (!admins.length) return;
    await notifyUsers({ tenantModels, userIds: admins.map((a) => a.id), ...resto });
  } catch (err) {
    process.stderr.write(`[notificaciones] no se pudo avisar a los admin: ${err.message}\n`);
  }
}

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
