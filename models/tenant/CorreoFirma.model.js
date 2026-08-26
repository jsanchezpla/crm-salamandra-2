import { DataTypes } from "sequelize";

/**
 * CorreoFirma — el pie de firma de UNA persona del equipo.
 *
 * Pedida por Rodrigo el 26/08/2026: «poder crear pies de firma (ya sea ahí o
 * subiendo una imagen/html) para cada persona del equipo y adjuntarlos de forma
 * automática». Una fila por cuenta (`user_id` único, referencia lógica a
 * master.users): la firma es de quien envía, no del centro, porque dos
 * profesionales del mismo centro firman distinto.
 *
 * `html` llega SANEADO por `lib/correo/composicion.js` (normalizarFirmaEntrada)
 * y `texto` es su versión plana, derivada allí mismo — nunca se guardan por
 * separado, para que el correo HTML y el de texto digan lo mismo.
 *
 * La imagen va en JSONB ({ nombre, tipo, base64 }, tope 1 MB) y no en el
 * volumen de uploads: al enviar se embebe como adjunto `cid:` en cada correo,
 * así que hace falta el binario a mano en cada envío, no una URL.
 */
export function defineCorreoFirma(sequelize) {
  return sequelize.define(
    "CorreoFirma",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      html: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      texto: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      imagen: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
      },
      // Quién la guardó por última vez (email): con admin editando las de todo
      // el equipo, «mía» no significa «la escribí yo».
      updatedBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "correo_firmas",
    }
  );
}
