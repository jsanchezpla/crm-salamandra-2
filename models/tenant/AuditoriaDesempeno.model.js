import { DataTypes } from "sequelize";

/**
 * AuditoriaDesempeno — la auditoría mensual de desempeño de una profesional
 * (módulo `auditorias`, 09/09/2026, AV-0100 de Aumenta).
 *
 * Una fila = una persona y un mes. Las áreas y sus criterios se guardan DENTRO
 * de la fila (`areas`, JSONB) y no se leen de la plantilla al pintarla: una
 * auditoría firmada tiene que seguir diciendo lo que decía aunque mañana se
 * añada un criterio. Mismo criterio que los apartados del informe clínico.
 *
 * Las reglas —qué se valora, qué NO decide un «no apto», qué se repite y quién
 * puede verla— viven en `lib/team/auditoriaDesempeno.js`, con su prueba.
 *
 * Enums con nombre `enum_auditorias_desempeno_<col>` para casar con lo que crea
 * `scripts/migrate-auditorias-module.js`.
 */
export function defineAuditoriaDesempeno(sequelize) {
  return sequelize.define(
    "AuditoriaDesempeno",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      /** A quién se audita. */
      teamMemberId: { type: DataTypes.UUID, allowNull: false, field: "team_member_id" },
      /** Quién audita. Es «el responsable» de la cabecera que pidió el centro. */
      auditorId: { type: DataTypes.UUID, allowNull: true, field: "auditor_id" },

      /** El mes auditado, «AAAA-MM». No es una fecha: es el periodo. */
      mes: { type: DataTypes.STRING(7), allowNull: false },
      /** El día en que se hizo la auditoría, que no tiene por qué caer en el mes. */
      fecha: { type: DataTypes.DATEONLY, allowNull: true },

      /**
       * Las cuatro áreas con sus criterios, valores y observaciones:
       * [{ key, label, criterios: [{ key, label, valor, observaciones }] }].
       */
      areas: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

      /** El cierre, tal cual lo pidió el centro. */
      fortalezas: { type: DataTypes.TEXT, allowNull: true },
      aspectosAMejorar: { type: DataTypes.TEXT, allowNull: true, field: "aspectos_a_mejorar" },
      accionAcordada: { type: DataTypes.TEXT, allowNull: true, field: "accion_acordada" },
      plazoRevision: { type: DataTypes.DATEONLY, allowNull: true, field: "plazo_revision" },
      observaciones: { type: DataTypes.TEXT, allowNull: true },

      /**
       * Favorable o requiere seguimiento. Lo escribe quien audita: NO se calcula
       * desde los «no apto» (`lib/team/auditoriaDesempeno.js` explica por qué).
       */
      resultado: {
        type: DataTypes.ENUM("favorable", "requiereSeguimiento"),
        allowNull: true,
      },

      /**
       * Qué pasó con lo que quedó pendiente de la auditoría anterior. Lo escribe
       * quien abre la nueva, mirando lo que el CRM le pone delante.
       */
      resueltoLoAnterior: { type: DataTypes.TEXT, allowNull: true, field: "resuelto_lo_anterior" },

      /**
       * Los pacientes que se revisaron durante la auditoría, por su id: «si
       * Araceli audita preguntándole por tres casos concretos, queda registrado
       * qué pacientes se revisaron». Sin nombres guardados aquí — el nombre lo
       * pone la ficha, que sí tiene permisos.
       */
      pacientesRevisados: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "pacientes_revisados" },

      /**
       * Borrador mientras se escribe; cerrada cuando se firma. Una cerrada la ve
       * la persona auditada; un borrador, no.
       */
      estado: {
        type: DataTypes.ENUM("borrador", "cerrada"),
        allowNull: false,
        defaultValue: "borrador",
      },
      cerradaAt: { type: DataTypes.DATE, allowNull: true, field: "cerrada_at" },
    },
    {
      tableName: "auditorias_desempeno",
      indexes: [
        { fields: ["team_member_id"], name: "auditorias_desempeno_member_idx" },
        { fields: ["mes"], name: "auditorias_desempeno_mes_idx" },
        // Una persona, un mes, una auditoría: dos del mismo mes serían dos
        // versiones de la misma conversación y nadie sabría cuál vale.
        { fields: ["team_member_id", "mes"], name: "auditorias_desempeno_unica", unique: true },
      ],
    }
  );
}
