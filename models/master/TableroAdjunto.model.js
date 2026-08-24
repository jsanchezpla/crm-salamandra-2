import { DataTypes } from "sequelize";

/**
 * Una captura colgada de una tarea del Registro. El fichero vive en disco
 * (`lib/tablero/tableroStorage.js` → volumen `/app/uploads`); aquí no hay bytes.
 *
 * ── POR QUÉ CUELGA DE LA FICHA Y NO DEL TÍTULO (24/08/2026) ────────────────
 * Todo lo demás que se guarda de una tarea —el tick, el reparto, la solución—
 * casa por TÍTULO NORMALIZADO (`lib/tablero/estado.js`). Eso tiene una herida
 * conocida y asumida desde el 12/08: si alguien reescribe el título, la fila se
 * queda huérfana. Con un tick huérfano no pasa nada; no casa con nada y no se
 * pinta.
 *
 * Con un FICHERO sí pasa: queda en disco, no lo alcanza nadie, y nadie lo va a
 * borrar. Un fichero perdido que además puede llevar datos de un paciente dentro
 * no es una molestia, es un problema. Por eso, antes de poder subir la primera
 * captura, se le puso a cada tarea una ficha propia dentro del texto
 * (`<!--id:…-->`), que sobrevive a que le cambien el título, a que se mueva de
 * sección y a que se cierre y pase a Resuelto.
 *
 * ⚠️ SIN FK, Y NO PORQUE SE HAYA OLVIDADO. La ficha no es la clave de ninguna
 * tabla: vive dentro de un texto versionado (`master.tablero_documentos`), que
 * es donde está la verdad de este Registro. No hay a qué apuntar. Lo que sí hay
 * es una poda (`scripts/podar-tablero-adjuntos.js`) que borra lo que ya no cuelga
 * de ninguna tarea viva, y ese es el sustituto del ON DELETE CASCADE.
 *
 * ⚠️ ESTAS CAPTURAS PUEDEN LLEVAR DATOS DE UN PACIENTE, y no se tapan (Jorge,
 * 24/08/2026: «sí puede, sin recortar nada»). Una captura recortada de la
 * pantalla que falla deja de ser la prueba de lo que falla. Las consecuencias:
 * viven lo que viva la tarea y ni un día más, no salen nunca del back-office, y
 * quien las sirve comprueba los tres candados de siempre — este panel es solo de
 * Salamandra, solo admin y nunca en una demo.
 */
export function defineTableroAdjunto(sequelize) {
  return sequelize.define(
    "TableroAdjunto",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /** La ficha de la tarea: `<!--id:k7m2p9-->` dentro de su bloque de texto. */
      ficha: { type: DataTypes.STRING(32), allowNull: false },
      /** De qué documento era la tarea al subirla. Informativo: la tarea se mueve. */
      documento: { type: DataTypes.STRING(20), allowNull: true },

      /** El nombre que traía el fichero, para enseñarlo y para descargarlo. */
      nombre: { type: DataTypes.STRING(255), allowNull: false },
      /** Ruta RELATIVA dentro de uploads. Nunca una ruta absoluta del servidor. */
      ruta: { type: DataTypes.STRING(500), allowNull: false },
      bytes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      mime: { type: DataTypes.STRING(120), allowNull: true },
      /** El correo de quien la subió. Somos dos: sirve para saber a quién preguntar. */
      subidoPor: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "tablero_adjuntos",
      indexes: [{ fields: ["ficha"] }],
    }
  );
}
