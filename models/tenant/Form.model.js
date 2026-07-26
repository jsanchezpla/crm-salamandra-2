import { DataTypes } from "sequelize";

/**
 * Form — definición de un formulario público del módulo Formularios.
 *
 * Las PREGUNTAS son datos, no código. Un formulario nuevo (o una pregunta más)
 * es una fila de esta tabla, no un despliegue: el formulario público y la
 * bandeja del CRM se pintan solos leyendo `fields`.
 *
 * Contrato de `fields` — array ordenado, cada elemento:
 *
 *   {
 *     key: "motivo",                     // [a-z0-9_]{1,40}, único en el formulario.
 *                                        // NUNCA se reutiliza para otra pregunta:
 *                                        // las respuestas antiguas quedarían mal etiquetadas.
 *     label: "Motivo breve de consulta", // el enunciado que lee la persona
 *     type: "textarea",                  // text|textarea|tel|email|number|select|checkbox|date|consent
 *     required: true,
 *     order: 3,                          // entero 1..n
 *     placeholder: null,
 *     help: null,
 *     options: [],                       // obligatorio y no vacío si type === "select"
 *     maxLength: 600, min: null, max: null,
 *     mapTo: "reason",                   // null|name|email|phone|age|reason
 *     linkUrl: null, linkLabel: null     // solo type "consent": enlace a la política
 *   }
 *
 * `mapTo` es lo que hace genérico al módulo: dice a qué parte de la ficha de
 * cliente sube cada respuesta al aceptar la solicitud. Las claves de destino
 * (edad, motivo, info_adicional) son EXACTAMENTE las que la ficha de
 * tunutrilaura ya pinta, así que aceptar no exige tocar su override.
 *
 * Contrato de `settings` — solo claves que el código lee de verdad:
 *
 *   { notifyEmails: ["info@tunutrilaura.com"],  // a quién se avisa. Vacío = no se avisa
 *     privacyUrl: "https://tunutrilaura.com/politica-de-privacidad/",
 *     privacyVersion: "2026-07",                // se copia en cada solicitud
 *     retentionDays: 365 }                      // purga de las DESCARTADAS
 */
export function defineForm(sequelize) {
  return sequelize.define(
    "Form",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      slug: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      introText: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "intro_text",
      },
      fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      submitLabel: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: "submit_label",
      },
      thankYouMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "thank_you_message",
      },
      settings: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // No se llama `order`: es palabra reservada en SQL y obliga a comillar
      // en cada consulta.
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "sort_order",
      },
    },
    {
      tableName: "forms",
      indexes: [
        { fields: ["slug"], unique: true, name: "forms_slug_unique" },
      ],
    }
  );
}
