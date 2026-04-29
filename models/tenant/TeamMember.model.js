import { DataTypes } from "sequelize";

export function defineTeamMember(sequelize) {
  return sequelize.define(
    "TeamMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Vínculo opcional con User del schema master.
      // PostgreSQL trata varios NULL como distintos en un UNIQUE estándar,
      // por lo que pueden coexistir miembros sin User (externos / subcontratados).
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        unique: true,
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
          isEmailIfPresent(value) {
            if (value == null || value === "") return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              throw new Error("email no es válido");
            }
          },
        },
      },
      position: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      department: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      avatarUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      hourlyCost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      hourlyRate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      // Salario mensual estimado. Solo informativo. NUNCA se usa en KPIs
      // financieros directos — eso lo hace la tabla Costes con type='salary'.
      // Solo admin/superadmin puede ver/editar. Filtrado en backend.
      monthlySalary: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "EUR",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "on_leave"),
        allowNull: false,
        defaultValue: "active",
      },
      hiredAt: {
        type: DataTypes.DATEONLY,
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
      tableName: "team_members",
    }
  );
}
