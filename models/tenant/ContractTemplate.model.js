import { DataTypes } from "sequelize";

/**
 * ContractTemplate — el contrato que se firma en el portal, con sus DATOS y sus
 * anexos (sprint tunutrilaura 2026-08-04).
 *
 * Hasta ahora el contrato del centro era un PDF suelto (`documents.source =
 * 'contract_template'`) y la firma un garabato: no se le pedía NINGÚN dato a
 * quien firmaba. El contrato de Laura pide ocho (nombre, DNI, domicilio,
 * correo, teléfono, fecha de nacimiento, localidad y fecha de la firma) y sus
 * tres anexos dicen literalmente que «se firman de forma independiente al
 * documento principal», así que hace falta una aceptación por anexo, no una
 * firma para todo el paquete.
 *
 * Por qué una tabla por tenant y no texto en el código: el módulo `documents`
 * lo comparten Aumenta y Laura, y un cambio de módulo llega a los dos. Meter
 * aquí el clausulado de TCA de Laura le saldría a Aumenta en su portal. Además
 * un contrato cambia (cambia la colaboradora del Anexo II, cambia un plazo) y
 * eso no puede exigir un despliegue.
 *
 * Forma de `fields` — lo que se le PIDE a quien firma:
 *   { key, label, type, required, group, placeholder, help }
 *   - type ∈ text | dni | email | tel | date | select | textarea
 *   - group: título del bloque de campos (agrupa «Datos del tutor» / «de la
 *     persona menor», que es justo lo que separa el consentimiento parental).
 *
 * Forma de `blocks` — lo que se LEE y se acepta, uno por documento:
 *   { id, title, body, acceptLabel, required }
 *   - body: el texto íntegro, tal cual sale en el PDF. Se enseña desplegable en
 *     el portal y se imprime entero en el PDF firmado: quien firma tiene
 *     derecho a una copia de lo que ha aceptado, no de un resumen.
 *
 * `key` identifica QUÉ se firma y es lo que ata la firma a su plantilla:
 *   - 'paciente' → contrato + anexos, lo firma todo el mundo.
 *   - 'parental' → consentimiento del tutor, solo si la destinataria es menor.
 * Son los dos que existen hoy; la columna es libre para el que venga.
 */
export function defineContractTemplate(sequelize) {
  return sequelize.define(
    "ContractTemplate",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      // Frase de entrada de la pantalla ("Antes de empezar necesitamos…").
      intro: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      blocks: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Pie del documento generado: colegiada, contacto, marca.
      footer: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      /**
       * Solo se pide si la destinataria es menor de edad. Lo decide la fecha de
       * nacimiento declarada en la plantilla 'paciente', no una casilla: una
       * casilla se desmarca y el consentimiento del tutor se lo salta quien no
       * quiere pedírselo a sus padres.
       */
      onlyMinors: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /**
       * Segunda firma OPCIONAL dentro del mismo documento (el «asentimiento de
       * la persona menor» del consentimiento parental, que el PDF marca como
       * opcional «según edad y madurez»). Vacío = documento de una sola firma.
       */
      secondSignatureLabel: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Se sube al cambiar el clausulado. Se guarda en cada firma para saber
      // QUÉ versión aceptó cada persona: sin esto, cambiar una cláusula
      // reescribiría hacia atrás lo que firmó quien firmó antes.
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      tableName: "contract_templates",
      indexes: [{ fields: ["key"], unique: true, name: "contract_templates_key_unique" }],
    }
  );
}
