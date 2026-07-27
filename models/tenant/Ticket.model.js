import { DataTypes } from "sequelize";

/**
 * Ticket de soporte del módulo `support`: el TENANT atiende aquí a SUS clientes
 * (helpdesk), no es el canal tenant→Salamandra (eso sigue siendo el placeholder
 * de /soporte cuando el módulo no está activo).
 *
 * El hilo de conversación vive en `ticket_messages` (tabla propia), NO aquí:
 * hace falta distinguir autor, respuestas públicas vs notas internas y medir la
 * primera respuesta para el SLA. La columna JSONB `messages` original queda en
 * BD sin uso (como `inventory_products`), retirada del modelo el 2026-07-27.
 *
 * `number` lo pone la BD con la secuencia `ticket_number_seq` del schema del
 * tenant (migrate-support-module): correlativo por tenant, para poder decir
 * "TK-0042" por teléfono. No asignar desde la app.
 */
export function defineTicket(sequelize) {
  return sequelize.define(
    "Ticket",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      contactId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      categoryId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("open", "in_progress", "waiting", "resolved", "closed"),
        allowNull: false,
        defaultValue: "open",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "critical"),
        allowNull: false,
        defaultValue: "medium",
      },
      // TeamMember.id del responsable (mismo criterio que Incidencia.assignedToId).
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // "manual" (alta desde el CRM) | "portal" (el cliente final, desde la web).
      channel: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "manual",
      },
      // Token URL-safe del enlace de seguimiento público. Es la ÚNICA llave del
      // portal: quien tiene el enlace ve el hilo público de ESTE ticket.
      portalToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      // Quién pidió ayuda, foto en el momento del alta. Se rellena SIEMPRE que
      // se sepa (portal o manual): si un día se desvincula la ficha, el ticket
      // sigue diciendo de quién era.
      requesterName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      requesterEmail: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // master.users.id de quien dio de alta el ticket desde el CRM.
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // ── SLA ────────────────────────────────────────────────────────────────
      // Los "due" se calculan al crear (según support_settings del tenant) y se
      // recalculan si cambia la prioridad ANTES de cumplirse el hito.
      firstResponseAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      firstResponseDueAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resolutionDueAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Última actividad del hilo (cualquier autor). Ordena la bandeja.
      lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "tickets",
    }
  );
}
