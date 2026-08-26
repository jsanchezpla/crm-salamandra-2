import { DataTypes } from "sequelize";
import { correoDeCuenta, esCorreo, normalizarCorreo } from "../../lib/auth/correoCuenta.js";

export function defineUser(sequelize) {
  const User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /**
       * ⚠️ ESTO NO ES UN CORREO: es el IDENTIFICADOR con el que se entra.
       *
       * Se llama `email` desde el primer día y por eso engaña, pero puede no
       * llevar arroba — las terapeutas de Aumenta entran con `nombre_aumenta`,
       * y por eso las tres puertas que crean usuarios pasan `validate: false`.
       * A dónde se le ESCRIBE a esta cuenta va en `emailContacto`, aquí abajo.
       * El porqué entero, en `lib/auth/correoCuenta.js`.
       */
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      /**
       * El correo DE VERDAD de esta cuenta (26/08/2026, Jorge). Dos trabajos:
       *
       *   · A dónde se le manda el enlace si pierde la contraseña. Sin esto no
       *     hay recuperación posible y quien se queda fuera depende de que uno
       *     de nosotros esté delante de un ordenador con SSH.
       *   · Un SEGUNDO identificador para entrar, además del de arriba
       *     («además de utilizar el usuario para entrar puedan utilizar su
       *     correo»). De ahí el `unique`.
       *
       * Nullable a propósito: el 26/08/2026 hay 14 cuentas vivas sin ninguna
       * dirección en ninguna parte del CRM, y ponerlo NOT NULL las dejaría sin
       * poder ni entrar. Obligatorio es al CREAR, que es lo que vigila el hook
       * de abajo, y así el agujero se cierra por arriba sin romper a nadie.
       */
      emailContacto: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
          esCorreoSiViene(value) {
            if (value == null || value === "") return;
            if (!esCorreo(value)) throw new Error("El correo de la cuenta no tiene forma de correo");
          },
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

  /*
   * ── LA PUERTA QUE NO SE PUEDE RODEAR (26/08/2026, Jorge: «si hay alguna
   *    manera más de crear usuarios que se ponga el correo como obligatorio») ──
   *
   * Hoy nacen usuarios por tres sitios —Equipo, el alta de cliente del
   * back-office y el script de la cuenta interna—, y mañana por un cuarto que
   * nadie recordará. Pedir el correo en cada formulario deja el agujero abierto
   * en el siguiente que se escriba, así que la exigencia va AQUÍ: por debajo de
   * todos ellos, de los seeds y de cualquier script futuro.
   *
   * Es un hook y no una `validate`: las tres puertas crean con
   * `validate: false` a propósito (el identificador puede no llevar arroba), y
   * una validación no se ejecutaría. Los hooks sí.
   *
   * Solo al CREAR. Un `beforeSave` tumbaría a las 14 cuentas que hoy no tienen
   * correo en cuanto entraran —el login les escribe `lastLoginAt`—, que es
   * exactamente lo contrario de lo que se busca.
   */
  User.addHook("beforeCreate", (user) => {
    if (user.emailContacto != null) user.emailContacto = normalizarCorreo(user.emailContacto) || null;
    if (typeof user.email === "string") user.email = normalizarCorreo(user.email);

    if (!correoDeCuenta(user)) {
      throw new Error(
        "Una cuenta nueva necesita un correo: es a donde se le manda el enlace si pierde la contraseña. " +
          "Ponlo en `emailContacto` (o usa un correo de verdad como identificador)."
      );
    }
  });

  /*
   * Al actualizar solo se NORMALIZA, nunca se exige: ver el hook de arriba.
   * Guardar un correo con mayúsculas o con un espacio delante lo dejaría fuera
   * de la búsqueda del login, que compara en minúsculas.
   */
  User.addHook("beforeUpdate", (user) => {
    if (user.changed("emailContacto") && user.emailContacto != null) {
      user.emailContacto = normalizarCorreo(user.emailContacto) || null;
    }
  });

  return User;
}
