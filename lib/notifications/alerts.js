/**
 * lib/notifications/alerts.js — generación de ALERTAS automáticas persistidas.
 *
 * En vez de un job en background, las alertas se SINCRONIZAN cuando el usuario
 * abre su campanita (GET /api/notifications). Se comparan las condiciones
 * actuales con lo ya guardado en `notifications` y se hace upsert:
 *   - crea las que falten (dedupe por índice único parcial user_id+type+entity_id),
 *   - borra las obsoletas (la condición ya no se cumple → p. ej. informe
 *     entregado, incidencia empezada/resuelta).
 * El estado "leído" se preserva mientras la alerta siga vigente.
 *
 * Alertas de Clínica (por terapeuta):
 *   - report_overdue     informe sin entregar con fecha de entrega vencida.
 *   - incidencia_pending incidencia asignada a mí en estado Pendiente.
 */

import { Op } from "sequelize";

export const AUTO_TYPES = ["report_overdue", "incidencia_pending"];

const isoDate = (d) => (d ? (typeof d === "string" ? d : new Date(d).toISOString()).slice(0, 10) : null);

// Crea las notificaciones que falten y borra las que ya no aplican, para un tipo.
async function syncType(Notification, userId, type, entityType, items) {
  for (const it of items) {
    await Notification.findOrCreate({
      where: { userId, type, entityId: it.entityId },
      defaults: {
        userId,
        channel: "app",
        type,
        entityType,
        entityId: it.entityId,
        title: it.title,
        body: it.body,
        read: false,
      },
    });
  }
  const where = { userId, channel: "app", type };
  const ids = items.map((i) => i.entityId);
  if (ids.length) where.entityId = { [Op.notIn]: ids };
  await Notification.destroy({ where });
}

/**
 * Sincroniza las alertas de Clínica del usuario (que es el TeamMember indicado).
 * No lanza: cualquier fallo se traga (las alertas son un añadido).
 */
export async function syncClinicaAlerts({ models, userId, teamMemberId }) {
  const { Notification, ClinicalReport, Incidencia, Patient } = models;
  if (!Notification || !ClinicalReport || !userId || !teamMemberId) return;
  try {
    // Informes vencidos: no entregados y con fecha de entrega ANTERIOR a hoy
    // (mismo criterio que la Bandeja; comparación por cadena YYYY-MM-DD para no
    // depender de la zona horaria del servidor).
    const today = new Date().toISOString().slice(0, 10);
    const pending = await ClinicalReport.findAll({
      where: { therapistId: teamMemberId, status: { [Op.ne]: "delivered" }, dueDate: { [Op.ne]: null } },
      include: [{ model: Patient, as: "patient", attributes: ["firstName", "lastName"], required: false }],
      limit: 200,
    });
    const reportItems = pending
      .map((r) => r.toJSON())
      .filter((j) => isoDate(j.dueDate) < today)
      .map((j) => {
        const name = [j.patient?.firstName, j.patient?.lastName].filter(Boolean).join(" ") || "paciente";
        return { entityId: j.id, title: "Informe vencido", body: `${name} · vencía el ${isoDate(j.dueDate)}` };
      });
    await syncType(Notification, userId, "report_overdue", "ClinicalReport", reportItems);

    // Incidencias asignadas a mí en estado Pendiente (aún sin empezar).
    if (Incidencia) {
      const inc = await Incidencia.findAll({ where: { assignedToId: teamMemberId, status: "pending" }, limit: 100 });
      const incItems = inc.map((r) => ({ entityId: r.id, title: "Incidencia asignada", body: r.title }));
      await syncType(Notification, userId, "incidencia_pending", "Incidencia", incItems);
    }
  } catch {
    // silencioso: si falta la tabla o algo peta, no rompemos la campanita.
  }
}

// Ruta destino en el dashboard según el tipo de entidad de la notificación.
export function notificationLink(entityType) {
  switch (entityType) {
    case "ClinicalReport":
      return "/clinica/informes";
    case "Incidencia":
      return "/clinica/incidencias";
    default:
      return null;
  }
}

export function serializeNotification(n) {
  const j = n.toJSON ? n.toJSON() : n;
  return {
    id: j.id,
    type: j.type,
    title: j.title,
    body: j.body ?? null,
    read: !!j.read,
    entityType: j.entityType ?? null,
    entityId: j.entityId ?? null,
    link: notificationLink(j.entityType),
    createdAt: j.createdAt ?? null,
  };
}
