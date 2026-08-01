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
      /**
       * Esta cuenta SOLO entra por el back-office (admin.salamandrasolutions.com),
       * nunca por el CRM. Y al revés: las cuentas normales no pueden entrar por
       * el back-office.
       *
       * ── POR QUÉ EXISTE ────────────────────────────────────────────────────
       * El panel interno guarda la ficha de TODOS los clientes. Hasta ahora lo
       * abría la misma cuenta que el CRM de Salamandra, así que una sola
       * contraseña robada daba las dos cosas. Separarlo por TENANT no valía:
       * `salamandra_solutions` usa su CRM de verdad (facturación, proyectos,
       * clientes), así que la separación tiene que ser por USUARIO.
       *
       * La cookie de sesión no lleva `domain`, o sea que es de host único y una
       * sesión del CRM nunca viaja al subdominio. Esto cierra la otra mitad:
       * que la credencial tampoco sirva para pedir esa sesión.
       */
      soloBackoffice: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
