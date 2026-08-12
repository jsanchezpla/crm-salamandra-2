import { DataTypes } from "sequelize";

/**
 * Un paquete de módulos: lo que se vende con un nombre.
 *
 * ── QUÉ ES Y QUÉ NO ES ──────────────────────────────────────────────────────
 * Un paquete es un ATAJO PARA MARCAR CASILLAS en el alta de clientes, y nada
 * más. **NINGÚN cliente «tiene» un paquete** (Jorge, 12/08/2026): todos los
 * tenants tienen una lista de módulos puesta a su gusto, y así se queda.
 *
 * Eso no es una limitación, es la decisión: lo que un cliente factura y lo que
 * ve en su menú tienen que poder divergir —un extra contratado no convierte a
 * nadie en «otro paquete»—, así que aquí no hay ninguna columna que apunte a un
 * tenant, ni FK, ni asociación. Se elige un paquete, se marcan sus módulos, y
 * desde ahí se añade o se quita lo que haga falta.
 *
 * ── POR QUÉ UNA TABLA Y NO EL FICHERO DE SIEMPRE ────────────────────────────
 * Hasta hoy los dos paquetes que había estaban escritos en
 * `lib/provisioning/catalogo.js`, así que inventar un tercero —o cambiar qué
 * lleva uno— era tocar código y desplegar. Su comentario avisaba de lo que eso
 * protegía: «solo se escribe aquí un paquete cuando está DECIDIDO qué lleva;
 * media definición en el código es peor que ninguna». Ese freno era el diff.
 *
 * Al mover la definición a datos, el freno se traslada al ENDPOINT: un paquete
 * no se puede guardar con módulos que no existen ni con dependencias que no se
 * sostienen (ver `lib/provisioning/paquetes.js`). Lo que no se hereda es la
 * revisión humana del diff, y por eso queda `tocadoPor`: para poder preguntar.
 *
 * Los dos paquetes de siempre entran como SEMILLA en la migración. A partir de
 * ahí manda esta tabla y solo esta tabla — si se borra el último paquete, el
 * alta se queda sin botones, que es justo lo que alguien habrá querido.
 */
export function definePaqueteModulos(sequelize) {
  return sequelize.define(
    "PaqueteModulos",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /**
       * Slug estable del paquete (`nutricion`, `clinica`…).
       *
       * ⚠️ Es un espacio de nombres PROPIO: no tiene nada que ver con las claves
       * de módulo de `master.tenant_modules`, y no viaja al alta. Que el paquete
       * de nutrición se llame `nutricion` igual que el módulo es casualidad
       * histórica, no una relación.
       */
      clave: {
        type: DataTypes.STRING(60),
        allowNull: false,
        unique: true,
      },
      /** Lo que se lee en el botón del alta. */
      nombre: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      /** Para qué es, en la lengua con la que se vende. Sale como `title`. */
      descripcion: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** Array de `moduleKey`. Validado contra el catálogo en el endpoint. */
      modulos: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      /** Orden de los botones en el alta. */
      orden: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      /** Retirarlo del alta sin perder qué llevaba. */
      activo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      /** Correo de quien lo tocó por última vez, para poder preguntarle. */
      tocadoPor: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "paquetes_modulos",
    }
  );
}
