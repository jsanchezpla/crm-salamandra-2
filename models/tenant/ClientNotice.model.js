import { DataTypes } from "sequelize";

/**
 * Aviso del centro a un cliente (03/08/2026).
 *
 * El CRM sabía avisar de cosas que le pasan a UNA CITA (confirmada, cancelada,
 * movida, enlace de la videollamada), pero no había forma de decirle nada más:
 * «cierro en agosto», «tráete los análisis», «te llamo mañana». Laura tenía que
 * salirse del CRM y escribir desde su correo personal, con lo que ese mensaje
 * dejaba de existir para el sistema — nadie sabía después qué se le había dicho
 * a quién.
 *
 * Un aviso hace dos cosas a la vez: sale por correo Y queda publicado en el
 * portal del cliente. Lo segundo importa más de lo que parece, porque el correo
 * se pierde entre otros cincuenta y el portal sigue ahí en enero.
 *
 * ── POR QUÉ LA CLAVE ES EL EMAIL Y NO `clientId` ────────────────────────────
 * Porque es como identifica el portal. La sesión llega por SSO de WordPress con
 * un email verificado, y `citas-portal/bookings` ya busca las citas por
 * `clientEmail`. Colgar los avisos de `clientId` los haría invisibles para
 * quien no tenga ficha creada —que es la mitad de la gente que reserva por la
 * web— y `patients.client_id`/`bookings.client_id` son nullable y a menudo
 * están vacíos (ver el sprint de conexión cliente/equipo del 2026-07-23).
 *
 * `clientId` se guarda igualmente cuando se conoce, pero solo para poder
 * enseñar el historial en la ficha. Quien manda es el email.
 */
export function defineClientNotice(sequelize) {
  return sequelize.define(
    "ClientNotice",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      /** A quién va. Siempre normalizado (trim + minúsculas), como bookings. */
      clientEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "client_email",
      },

      /** Ficha, si la tiene. Solo para el historial del CRM. */
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "client_id",
      },

      /** Cita a la que se refiere, si el aviso nace desde una. */
      bookingId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "booking_id",
      },

      title: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },

      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      /** Quién lo escribió (patrón del sprint cliente/equipo). */
      createdByTeamId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "created_by_team_id",
      },

      /**
       * Qué pasó con el correo: "enviado" | "sin_configurar" | "error" |
       * "sin_consentimiento". Se guarda porque el aviso vale igual aunque el
       * correo no salga —queda en el portal—, pero quien lo escribió tiene que
       * saber si además le llegó al buzón o no.
       */
      emailStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "enviado",
        field: "email_status",
      },

      /** Cuándo lo vio en el portal. NULL = sin leer. */
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "read_at",
      },
    },
    {
      tableName: "client_notices",
      underscored: true,
      indexes: [
        // El índice que usa el portal en cada carga.
        { fields: ["client_email", "created_at"], name: "client_notices_email_created_idx" },
        { fields: ["client_id"], name: "client_notices_client_idx" },
        { fields: ["booking_id"], name: "client_notices_booking_idx" },
      ],
    }
  );
}
