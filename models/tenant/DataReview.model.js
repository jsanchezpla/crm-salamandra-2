import { DataTypes } from "sequelize";

/**
 * DataReview — «esto ya lo he mirado y está bien así».
 *
 * La pantalla «Fichas a completar» (`/clientes/urgentes`) lista huecos de datos:
 * pacientes sin terapeuta, familias sin teléfono, citas sin profesional. Pero
 * un hueco no siempre es un error: un paciente en lista de espera NO tiene
 * terapeuta, y eso es correcto.
 *
 * Sin una forma de archivar esas filas, la pantalla no llega a cero nunca y en
 * dos semanas nadie la abre. Esta tabla es esa forma: una fila por (tipo de
 * hueco, registro), y el contador de la carpeta la descuenta.
 *
 * NO guarda datos del paciente ni de la familia: solo a qué apunta. Lo que se
 * revisa vive en su tabla; esto es una marca, no una copia.
 */
export function defineDataReview(sequelize) {
  return sequelize.define(
    "DataReview",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Qué carpeta: `sin_terapeuta`, `sin_tutor`… (ver lib/clients/urgentes.js)
      checkKey: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      // A quién apunta. Sin FK a propósito: unas filas son clientes y otras
      // pacientes, y una FK condicional no existe. Si el registro desaparece,
      // la marca se queda huérfana y no molesta a nadie: nunca se lista sola.
      entityId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      entityType: {
        type: DataTypes.ENUM("client", "patient"),
        allowNull: false,
      },
      reviewedById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "data_reviews",
      indexes: [
        // Un registro solo se puede archivar UNA vez por carpeta.
        { unique: true, fields: ["check_key", "entity_id"], name: "data_reviews_check_entity_unique" },
        { fields: ["check_key"], name: "data_reviews_check_idx" },
      ],
    }
  );
}
