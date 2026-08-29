import { DataTypes } from "sequelize";

/*
 * La cuenta de Google que un miembro del equipo conectó al Calendario
 * (29/08/2026, Rodrigo). Una por persona (`teamMemberId` único).
 *
 * `calendarId` es el calendario «CRM Salamandra» que el CRM le creó en su
 * Google al conectar: los eventos donde aparece se escriben AHÍ, nunca en su
 * calendario personal. El nombre lo puede cambiar en Google cuando quiera — el
 * id no cambia, que es lo único que guardamos.
 *
 * `accessToken` y `refreshToken` se guardan CIFRADOS (lib/crypto/secretBox.js),
 * como el resto de credenciales en reposo: un volcado de la base no puede
 * regalar el calendario de nadie.
 */
export function defineGoogleCalendarConnection(sequelize) {
  return sequelize.define(
    "GoogleCalendarConnection",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      googleEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      refreshToken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      tokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      calendarId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      tableName: "google_calendar_connections",
      underscored: true,
    }
  );
}
