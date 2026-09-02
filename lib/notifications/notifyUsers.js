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
export async function notifyAdmins({ tenantId, tenantModels, excepto = null, ...resto }) {
  try {
    const { getMasterModels } = await import("../db/masterDb.js");
    const { User } = getMasterModels();
    const admins = await User.findAll({
      where: { tenantId, role: "admin" },
      attributes: ["id"],
    });
    // `excepto` (02/09/2026): quien ha provocado el aviso, si es admin, no
    // tiene que recibirlo (un comentario propio en una incidencia, p. ej.).
    const userIds = admins.map((a) => a.id).filter((id) => id !== excepto);
    if (!userIds.length) return;
    await notifyUsers({ tenantModels, userIds, ...resto });
  } catch (err) {
    process.stderr.write(`[notificaciones] no se pudo avisar a los admin: ${err.message}\n`);
  }
}

// Crea una notificación de campana para cada userId (master.users.id).
// Con `dedupe: true` usa findOrCreate sobre (userId, type, entityId) para no
// duplicar avisos del mismo hecho.
// Con `reemplazar: true` (revisión 02/09/2026) se QUITA el aviso anterior del
// mismo hecho para la misma persona y se crea el nuevo: la tabla tiene un
// índice único (user_id, type, entity_id), así que un segundo `create` a secas
// fallaba en silencio y solo llegaba el PRIMER comentario de una incidencia.
export async function notifyUsers({ tenantModels, userIds, type, title, body, entityType, entityId, dedupe = false, reemplazar = false }) {
  const { Notification } = tenantModels;
  if (!Notification || !Array.isArray(userIds) || userIds.length === 0) return;
  for (const userId of new Set(userIds.filter(Boolean))) {
    try {
      const values = { userId, channel: "app", type, title, body: body ?? null, entityType: entityType ?? null, entityId: entityId ?? null };
      if (dedupe && entityId) {
        await Notification.findOrCreate({ where: { userId, type, entityId }, defaults: values });
      } else {
        if (reemplazar && entityId && typeof Notification.destroy === "function") {
          await Notification.destroy({ where: { userId, type, entityId } });
        }
        await Notification.create(values);
      }
    } catch {
      // best-effort
    }
  }
}
