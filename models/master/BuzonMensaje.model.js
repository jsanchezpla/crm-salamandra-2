import { DataTypes } from "sequelize";

/**
 * Una línea del hilo de un aviso del buzón.
 *
 * TABLA PROPIA Y NO UNA COLUMNA JSONB, por dos cosas que un array no aguanta
 * bien: saber quién escribió cada línea y cuándo, y poder marcar las NOTAS
 * INTERNAS que el cliente no ve. La columna `messages` JSONB de `tickets` nació
 * así y quedó muerta por exactamente este motivo (`docs/modules/support.md`).
 *
 * `interno` es la que hay que mirar dos veces al pintar: una nota nuestra
 * («esto es el bug de las citas de julio») no puede salir en la pantalla del
 * cliente. El filtro va en el serializador de `lib/buzon/buzon.js`, en un solo
 * sitio, para que no se le olvide a ningún endpoint.
 */
export function defineBuzonMensaje(sequelize) {
  return sequelize.define(
    "BuzonMensaje",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      avisoId: { type: DataTypes.UUID, allowNull: false },

      /** "cliente" | "salamandra" */
      autorTipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "cliente" },
      autorNombre: { type: DataTypes.STRING(255), allowNull: true },
      autorEmail: { type: DataTypes.STRING(255), allowNull: true },

      cuerpo: { type: DataTypes.TEXT, allowNull: false },

      /** Nota nuestra. NUNCA se le manda al cliente ni se le pinta. */
      interno: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "buzon_mensajes",
    }
  );
}
