import { DataTypes } from "sequelize";

/**
 * El TEXTO del Registro: `backlog` y `resuelto`, en el mismo markdown de siempre,
 * una fila por versión.
 *
 * POR QUÉ UNA TABLA, SI ERAN DOS FICHEROS DEL REPO (19/08/2026, Jorge)
 * Hasta ese día `docs/backlog.md` y `docs/resuelto.md` viajaban DENTRO de la
 * imagen de Docker, así que apuntar una tarea costaba lo mismo que desplegar una
 * función: commit, build y `deploy.sh`. Jorge quiso reservar los commits para
 * código —«algo que haya que poder volver atrás»— y no para apuntar en un
 * fichero. Con el texto aquí, apuntar son segundos
 * (`scripts/registro.mjs subir`), el apunte sobrevive a cualquier despliegue, y
 * «volver atrás» lo da el historial de versiones de esta misma tabla.
 *
 * Lo que se PIERDE, sabido: el `git blame` de las tareas (lo sustituye
 * `historial`, con quién y con qué nota publicó cada versión) y el diff de git
 * que delataba un `###` mal puesto (lo sustituye `comprobar` en
 * `lib/tablero/parser.js`, que corre ANTES de cada escritura y se niega si no
 * casa).
 *
 * ES APPEND-ONLY: publicar es insertar la versión siguiente, nunca tocar una
 * fila. La actual es la de `version` más alta de cada `nombre`. Restaurar una
 * vieja es publicarla otra vez como versión nueva, así el historial cuenta lo
 * que pasó de verdad. Se podan las versiones más allá de las últimas 50 por
 * documento (`lib/tablero/documentos.js`), que con 200 KB por versión mantiene
 * la tabla por debajo de 20 MB.
 *
 * El estado que se cambia en caliente desde la pantalla —tick, reparto y
 * solución— sigue en `tablero_estado`, casado por título normalizado, como
 * siempre.
 */
export function defineTableroDocumento(sequelize) {
  return sequelize.define(
    "TableroDocumento",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /** "backlog" | "resuelto" (`DOCUMENTOS` en lib/tablero/parser.js). */
      nombre: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      /** Correlativo por documento, empieza en 1. UNIQUE (nombre, version). */
      version: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      /** El markdown entero, con finales de línea LF. */
      contenido: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      /** Por qué esta versión: «apuntar el buscador de aumenta», «cerrar AV-0007»… */
      nota: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** Quién la publicó: usuario de la máquina desde la que se subió, o un correo. */
      publicadoPor: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      /** Cuántas tareas pinta el tablero de esta versión, para el historial. */
      tareas: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "tablero_documentos",
      indexes: [{ unique: true, fields: ["nombre", "version"] }],
    }
  );
}
