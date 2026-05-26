import { DataTypes } from "sequelize";

/**
 * Convención de días de la semana — coincide con `Date.prototype.getDay()`
 * de JavaScript: 0 = domingo, 6 = sábado.
 *
 * La UI muestra la semana empezando en lunes pero el modelo persiste con la
 * convención JS para evitar transformaciones al pintar slots con la API
 * estándar de fechas del navegador.
 */
export const DAYS_OF_WEEK = [
  { value: 0, label: "Domingo", short: "Dom" },
  { value: 1, label: "Lunes", short: "Lun" },
  { value: 2, label: "Martes", short: "Mar" },
  { value: 3, label: "Miércoles", short: "Mié" },
  { value: 4, label: "Jueves", short: "Jue" },
  { value: 5, label: "Viernes", short: "Vie" },
  { value: 6, label: "Sábado", short: "Sáb" },
];

/**
 * Availability — disponibilidad horaria configurable por día de la semana.
 *
 * Si `eventTypeId` es null, el bloque aplica a todos los EventType del tenant.
 * Si no, es específico de un EventType. Las validaciones de solapamiento se
 * hacen a nivel de endpoint (no a nivel de tabla).
 */
export function defineAvailability(sequelize) {
  return sequelize.define(
    "Availability",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // 0=domingo .. 6=sábado (convención JS getDay)
      dayOfWeek: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 6 },
      },
      startTime: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      endTime: {
        type: DataTypes.TIME,
        allowNull: false,
      },
    },
    {
      tableName: "availabilities",
      indexes: [
        { fields: ["event_type_id", "day_of_week"], name: "availabilities_event_type_day_idx" },
      ],
    }
  );
}
