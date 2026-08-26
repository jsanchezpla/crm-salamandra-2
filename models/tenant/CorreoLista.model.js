import { DataTypes } from "sequelize";

/**
 * CorreoLista — una lista de destinatarios con nombre, para reutilizarla.
 *
 * Pedida por Rodrigo el 26/08/2026 («poder hacer listas personalizadas»): quien
 * escribe cada mes a las mismas cuarenta familias no debería reconstruir la
 * selección cada vez.
 *
 * Los destinatarios se guardan DESNORMALIZADOS ({ email, nombre, detalle,
 * fuente }) a propósito: la lista es una foto de a quién se eligió, no una
 * consulta. Si una familia cambia de correo, la lista guarda el viejo hasta que
 * alguien la revise — igual que una lista de distribución de toda la vida. Una
 * lista «viva» (guardar el filtro y reevaluarlo) sería otra feature, y peor de
 * explicar: nadie espera que una lista se edite sola.
 */
export function defineCorreoLista(sequelize) {
  return sequelize.define(
    "CorreoLista",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      nombre: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      // [{ email, nombre, detalle, fuente }] — ver app/api/correo/listas.
      destinatarios: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Referencia lógica al email de quien la creó (master.users), sin FK:
      // la lista es del centro y sobrevive a la baja de la cuenta.
      createdBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "correo_listas",
      indexes: [{ fields: ["nombre"], name: "correo_listas_nombre_idx" }],
    }
  );
}
