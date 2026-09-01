import { DataTypes } from "sequelize";

/*
 * Categoría de un evento del Calendario (01/09/2026, Rodrigo).
 *
 * El catálogo de «de qué va» cada cosa que se apunta en el Calendario:
 * Reunión de equipo, Coordinación con el colegio, Formación, Gestión… Lo pone
 * cada centro, con su nombre y su color, exactamente igual que los TIPOS DE
 * CITA de Citas (`EventType`) — es la misma idea aplicada a la otra agenda, y
 * la pantalla es la misma tabla con el mismo drawer.
 *
 * NO es un `EventType`: un tipo de cita es un SERVICIO que se reserva (tiene
 * duración, precio, modalidades, reglas de antelación y sale en la agenda
 * pública). Una categoría del Calendario no se vende ni se reserva: solo
 * clasifica y da color a una reunión interna. Meterlas en la misma tabla
 * habría obligado a que media docena de campos obligatorios no significaran
 * nada aquí, y a que el widget público tuviera que aprender a esconderlas.
 *
 * `active` dice si se sigue usando: una categoría desactivada no se ofrece al
 * apuntar nada nuevo, pero los eventos que ya la tenían la conservan (y
 * conservan su color). Por eso al borrar una que está en uso se desactiva en
 * vez de borrarse, como en los tipos de cita.
 */
export function defineCalendarCategory(sequelize) {
  return sequelize.define(
    "CalendarCategory",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** Hexadecimal `#RRGGBB`. Es lo que pinta el evento en el calendario. */
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "calendar_categories",
      underscored: true,
      indexes: [{ fields: ["active", "order"], name: "calendar_categories_active_order_idx" }],
    }
  );
}
