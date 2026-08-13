import { DataTypes } from "sequelize";

/**
 * La ficha de un fichero adjunto a un aviso del buzón. El fichero en sí vive en
 * disco (`lib/buzon/buzonStorage.js` → volumen `/app/uploads`); la BD no guarda
 * bytes.
 *
 * `mensajeId` nulo significa «adjunto del alta», o sea de la descripción
 * inicial y no de una respuesta posterior. Mismo criterio que
 * `TicketAttachment`.
 *
 * ⚠️ EL CANDADO NO ESTÁ AQUÍ, Y AQUÍ IMPORTA MÁS QUE EN TICKETS. En un ticket el
 * aislamiento lo daba el schema del tenant: pedir el adjunto de otro cliente era
 * imposible porque la tabla ni se veía. Esta tabla vive en MASTER y la ven
 * todos, así que quien sirve el fichero tiene que comprobar ANTES que el adjunto
 * cuelga de un aviso del tenant que lo pide. Eso se hace en
 * `app/api/ayuda/adjuntos/[adjuntoId]/route.js`, no en el modelo.
 */
export function defineBuzonAdjunto(sequelize) {
  return sequelize.define(
    "BuzonAdjunto",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      avisoId: { type: DataTypes.UUID, allowNull: false },
      /** Nulo = adjunto de la descripción inicial. */
      mensajeId: { type: DataTypes.UUID, allowNull: true },

      /** El nombre que traía el fichero, para enseñarlo y para descargarlo. */
      nombre: { type: DataTypes.STRING(255), allowNull: false },
      /** Ruta RELATIVA dentro de uploads. Nunca una ruta absoluta del servidor. */
      ruta: { type: DataTypes.STRING(500), allowNull: false },
      bytes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      mime: { type: DataTypes.STRING(120), allowNull: true },
      /** "cliente" | "salamandra" */
      subidoPor: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "cliente" },
    },
    {
      tableName: "buzon_adjuntos",
    }
  );
}
