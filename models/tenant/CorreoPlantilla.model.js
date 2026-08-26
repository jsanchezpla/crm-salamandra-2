import { DataTypes } from "sequelize";

/**
 * CorreoPlantilla — un asunto y un cuerpo guardados para reutilizarlos.
 *
 * Pedida por Rodrigo el 26/08/2026 («hay que poder crear plantillas de correo
 * ilimitadas»). Sin tope de filas a propósito: el tope sería un número inventado
 * y la petición dice justo lo contrario. Lo que sí está acotado es cada campo
 * (mismos topes que el envío: asunto 200, cuerpo 20.000).
 *
 * No confundir con `lib/email/templates/`: aquellas son las plantillas de
 * SISTEMA (confirmaciones de cita, facturas…), viven en el código y las manda
 * la máquina. Estas las escribe una persona y las manda una persona.
 */
export function defineCorreoPlantilla(sequelize) {
  return sequelize.define(
    "CorreoPlantilla",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      nombre: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      asunto: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      cuerpo: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Referencia lógica (email de master.users), sin FK: ver CorreoLista.
      createdBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "correo_plantillas",
      indexes: [{ fields: ["nombre"], name: "correo_plantillas_nombre_idx" }],
    }
  );
}
