import { DataTypes } from "sequelize";

export function defineUser(sequelize) {
  return sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("superadmin", "admin", "manager", "user"),
        allowNull: false,
        defaultValue: "user",
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      moduleAccess: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tokenVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "users",
      defaultScope: {
        attributes: { exclude: ["passwordHash"] },
      },
      scopes: {
        withPassword: {
          attributes: { include: ["passwordHash"] },
        },
      },
    }
  );
}
