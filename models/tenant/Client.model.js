import { DataTypes } from "sequelize";

export function defineClient(sequelize) {
  return sequelize.define(
    "Client",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM("individual", "company"),
        allowNull: false,
        defaultValue: "company",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      taxId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // ── Datos fiscales para facturación (relleno bajo demanda) ──────────
      // No se migran automáticamente desde customFields/address; se piden
      // al editar la ficha o al emitir la primera factura para el cliente.
      fiscalName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalCity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalZip: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      fiscalCountry: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: "ES",
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "prospect"),
        allowNull: false,
        defaultValue: "active",
      },
      portalAccess: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      portalEmail: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "clients",
    }
  );
}
