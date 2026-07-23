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
      // Color hex (`#rrggbb`) usado como fondo del avatar circular cuando
      // no hay `avatarUrl`. Backfill determinista en migrate-team-members-
      // avatar-color.js (`'#' || SUBSTR(MD5(id::text), 1, 6)`), así que el
      // mismo id siempre tiene el mismo color en cualquier entorno.
      avatarColor: {
        type: DataTypes.STRING(7),
        field: "avatar_color",
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
      // Bruto anual. Fuente de verdad de la retribución: monthlySalary se
      // CALCULA en backend = annualGross / paymentPeriods (no se edita directo).
      // Solo admin/superadmin. Ver serializeTeamMember + PATCH /api/team/[id].
      annualGross: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      // Nº de pagas al año (12 normal, 14 frecuente en España). Default 12.
      paymentPeriods: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 12,
        validate: { isIn: [[12, 14]] },
      },
      // Salario mensual. Ahora DERIVADO (= annualGross / paymentPeriods),
      // calculado y persistido en backend. Solo informativo (no se usa en KPIs
      // directos — eso lo hace Costes type='salary'). Solo admin ve/lo recibe.
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
      // Especialidad(es) clínica(s) del profesional: su rol concreto
      // (Nutrición, Logopedia, Psicología…). Taxonomía en
      // lib/clinica/specialties.js. Array: puede cubrir varias. Sólo tiene
      // sentido si el miembro atiende pacientes (módulo Clínica o Nutrición).
      specialties: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
    },
    {
      tableName: "team_members",
    }
  );
}
