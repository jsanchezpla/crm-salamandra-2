import { DataTypes } from "sequelize";

export function defineTrainingSyncLog(sequelize) {
  return sequelize.define(
    "TrainingSyncLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      source: {
        type: DataTypes.ENUM("wp_tutor_courses"),
        allowNull: false,
      },
      syncedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      itemsSynced: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      itemsDeactivated: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      itemsFailed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "training_sync_log",
    }
  );
}
