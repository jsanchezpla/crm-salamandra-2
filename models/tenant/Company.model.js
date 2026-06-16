import { DataTypes } from "sequelize";

export function defineCompany(sequelize) {
  return sequelize.define(
    "Company",
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
      externalId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // NIF del centro/empresa. Usado para auto-vincular CourseRegistration
      // por NIF al recibir un POST del form de Retorika. Alineado con
      // TrainingUser.nif (mismo módulo training). Nullable porque hay
      // empresas históricas sin NIF cargado.
      nif: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      settings: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "companies",
    }
  );
}
