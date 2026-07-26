import { DataTypes } from "sequelize";

/**
 * FormSubmission — una solicitud enviada desde un formulario público.
 *
 * Ciclo de vida: `pending` (recién llegada, en la bandeja) → `accepted` (la
 * nutricionista la aceptó y se creó la ficha de cliente) o `rejected`
 * (descartada). Nunca se borra al aceptar ni al rechazar: el histórico se
 * conserva, y solo las DESCARTADAS se purgan pasado el plazo de retención.
 *
 * `answers` es la fuente de verdad y guarda el ENUNCIADO junto a la respuesta:
 *
 *   [{ key: "motivo", label: "Motivo breve de consulta",
 *      type: "textarea", value: "…" }, …]
 *
 * Guardar el enunciado dentro parece redundante, pero es lo que hace que una
 * solicitud de hace un año siga leyéndose bien aunque la pregunta se haya
 * reformulado después. Sin eso, el histórico mentiría.
 *
 * NO se guarda la IP, ni en claro ni hasheada: un hash de IPv4 sin sal se
 * revierte por fuerza bruta en minutos, así que sería un dato personal
 * disfrazado de anónimo. No hace falta para nada del flujo.
 *
 * `clientId` es además el GUARD DE IDEMPOTENCIA: si tiene valor, esta
 * solicitud ya se aceptó y no puede volver a crear otra ficha.
 */
export function defineFormSubmission(sequelize) {
  return sequelize.define(
    "FormSubmission",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // FK lógica a forms (sin FK física, mismo criterio que Lead.clientId).
      formId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "form_id",
      },
      // Instantáneas del formulario en el momento del envío: si mañana se
      // renombra, el histórico no miente.
      formSlug: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: "form_slug",
      },
      formTitle: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "form_title",
      },

      // Extraídos de las respuestas vía `mapTo`, para poder listar y buscar
      // sin abrir el JSONB en cada consulta.
      name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          esEmailSiLoHay(valor) {
            if (valor == null || valor === "") return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor))) {
              throw new Error("email no válido");
            }
          },
        },
      },
      phone: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      answers: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      // VARCHAR + validación, no ENUM nativo: cambiar un enum de PostgreSQL
      // más adelante es caro y aquí no aporta nada.
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
        validate: { isIn: [["pending", "accepted", "rejected"]] },
      },

      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "accepted_at",
      },
      rejectedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "rejected_at",
      },
      // Motivo INTERNO del descarte. Nunca se envía a la persona.
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "rejection_reason",
      },
      internalNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "internal_notes",
      },
      handledBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "handled_by",
      },
      // Miembro del equipo que atendió la solicitud (2026-07-23). Enlace real
      // que sustituye a `handledBy` (texto con el email). Se rellena al
      // aceptar o descartar.
      handledByTeamId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "handled_by_team_id",
      },
      sourceUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "source_url",
      },
      // 0 = limpia. ≥2 = sospechosa (ver lib/formularios/antispam.js).
      spamScore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "spam_score",
      },

      // Prueba del consentimiento: cuándo, qué literal aceptó y de qué versión
      // de la política. Es lo que permite demostrarlo si algún día se pide.
      consentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "consent_at",
      },
      consentText: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "consent_text",
      },
      consentVersion: {
        type: DataTypes.STRING(32),
        allowNull: true,
        field: "consent_version",
      },
    },
    {
      tableName: "form_submissions",
      indexes: [
        { fields: ["status", "created_at"], name: "form_submissions_status_created_idx" },
        { fields: ["form_id"], name: "form_submissions_form_idx" },
        { fields: ["client_id"], name: "form_submissions_client_idx" },
        { fields: ["phone"], name: "form_submissions_phone_idx" },
      ],
    }
  );
}
