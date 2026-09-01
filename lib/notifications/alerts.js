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
import { madridToday } from "../utils/madridDate.js";
import { whereIncidenciasDe } from "../clinica/incidenciasDe.js";

export const AUTO_TYPES = ["report_overdue", "incidencia_pending", "ticket_sla"];

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
    // (mismo criterio que la Bandeja; "hoy" en hora ESPAÑOLA — el servidor
    // corre en UTC). El filtro de vencido va EN SQL y con ORDER determinista:
    // filtrar en JS tras un LIMIT sin orden devolvía un subconjunto arbitrario
    // y el sync podía borrar alertas aún vigentes (flapping + pérdida de leído).
    const today = madridToday();
    const overdueRows = await ClinicalReport.findAll({
      where: { therapistId: teamMemberId, status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: today } },
      include: [{ model: Patient, as: "patient", attributes: ["firstName", "lastName"], required: false }],
      order: [["dueDate", "ASC"]],
      limit: 200,
    });
    const reportItems = overdueRows
      .map((r) => r.toJSON())
      .map((j) => {
        const name = [j.patient?.firstName, j.patient?.lastName].filter(Boolean).join(" ") || "paciente";
        return { entityId: j.id, title: "Informe vencido", body: `${name} · vencía el ${isoDate(j.dueDate)}` };
      });
    await syncType(Notification, userId, "report_overdue", "ClinicalReport", reportItems);

    // Incidencias asignadas a mí en estado Pendiente (aún sin empezar).
    // Por la tabla PIVOTE (31/08/2026): antes miraba solo assignedToId y el
    // 2.º responsable no se enteraba — la regla, en lib/clinica/incidenciasDe.
    // ORDER determinista por el mismo motivo que arriba.
    if (Incidencia) {
      const deMio = await whereIncidenciasDe(models, teamMemberId);
      const inc = await Incidencia.findAll({
        where: { ...deMio, status: "pending" },
        order: [["createdAt", "ASC"]],
        limit: 100,
      });
      const incItems = inc.map((r) => ({ entityId: r.id, title: "Incidencia asignada", body: r.title }));
      await syncType(Notification, userId, "incidencia_pending", "Incidencia", incItems);
    }
  } catch {
    // silencioso: si falta la tabla o algo peta, no rompemos la campanita.
  }
}

/**
 * Alertas del módulo Soporte: tickets activos con algún hito del SLA VENCIDO
 * (primera respuesta sin dar a tiempo, o resolución fuera de plazo). Sync, no
 * directas: si el equipo responde/resuelve, la alerta desaparece sola en el
 * siguiente barrido de la campana. Ve las suyas quien las tiene asignadas; el
 * ADMIN ve además las de nadie (sin asignar), que son las que nadie mira.
 */
export async function syncSupportAlerts({ models, userId, teamMemberId, isAdmin }) {
  const { Notification, Ticket } = models;
  if (!Notification || !Ticket || !userId) return;
  try {
    const now = new Date();
    const vencidoSla = {
      [Op.or]: [
        { firstResponseAt: null, firstResponseDueAt: { [Op.lt]: now } },
        { resolvedAt: null, resolutionDueAt: { [Op.lt]: now } },
      ],
    };
    const quien = [];
    if (teamMemberId) quien.push({ assignedTo: teamMemberId });
    if (isAdmin) quien.push({ assignedTo: null });
    if (quien.length === 0) {
      await syncType(Notification, userId, "ticket_sla", "Ticket", []);
      return;
    }
    const rows = await Ticket.findAll({
      where: {
        status: ["open", "in_progress", "waiting"],
        [Op.and]: [vencidoSla, { [Op.or]: quien }],
      },
      order: [["createdAt", "ASC"]],
      limit: 100,
    });
    const items = rows.map((r) => {
      const j = r.toJSON();
      const ref = j.number != null ? `TK-${String(j.number).padStart(4, "0")}` : "Ticket";
      const motivo = !j.firstResponseAt && j.firstResponseDueAt && new Date(j.firstResponseDueAt) < now
        ? "sin primera respuesta"
        : "resolución fuera de plazo";
      return { entityId: j.id, title: "SLA vencido", body: `${ref} · ${j.title} · ${motivo}` };
    });
    await syncType(Notification, userId, "ticket_sla", "Ticket", items);
  } catch {
    // silencioso: si falta la tabla o algo peta, no rompemos la campanita.
  }
}

// Ruta destino en el dashboard según el tipo de entidad de la notificación.
// `entityId` es opcional: los tickets enlazan directo a su ficha en la bandeja.
export function notificationLink(entityType, entityId = null) {
  switch (entityType) {
    case "ClinicalReport":
      return "/clinica/informes";
    case "Incidencia":
      // Las herramientas de gestión de equipo se movieron de /clinica a /equipo
      // (2026-07-27). El enlace se calcula al leer la campanita, así que las
      // notificaciones ya guardadas también apuntan al sitio nuevo.
      return "/equipo/incidencias";
    case "BookingChangeRequest":
      return "/citas";
    case "Document":
      // Un documento que hay que LEER (01/09/2026). No enlaza al fichero sino a
      // la lista de lo pendiente: desde ahí se abre —y abrirlo es lo que sella
      // el acuse— y además se ve lo demás que le falte por leer. Sin `entityId`
      // en la URL por lo mismo que el buzón: la pantalla ya solo tiene lo suyo.
      return "/documentos/lecturas";
    case "Ticket":
      return entityId ? `/soporte?ticket=${entityId}` : "/soporte";
    case "BuzonAviso":
      // Lo que NOSOTROS le hemos contestado desde el panel. No lleva el id en la
      // URL porque `/ayuda` ya le enseña los suyos y solo tiene los que él
      // escribió: no hay nada que buscar.
      return "/ayuda";
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
    link: notificationLink(j.entityType, j.entityId),
    createdAt: j.createdAt ?? null,
  };
}
