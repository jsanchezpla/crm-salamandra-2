import { DataTypes } from "sequelize";

/**
 * Estado que el Registro pone ENCIMA de una tarea de los ficheros.
 *
 * POR QUÉ UNA TABLA, SI EL BACKLOG ES UN FICHERO (12/08/2026, decisión de Rodrigo)
 * `docs/backlog.md` y `docs/resuelto.md` siguen siendo la fuente del TEXTO de
 * cada tarea, y se editan en el repositorio junto al código que las resuelve.
 * Lo que no cabía ahí es el estado que se cambia en caliente desde el móvil
 * —«esto es tuyo», «esto ya está»—, porque los dos ficheros viajan DENTRO de la
 * imagen de Docker: cualquier cosa que la pantalla escribiera en ellos la
 * borraría el siguiente despliegue, sin dar ningún error.
 *
 * Por eso el reparto es: el texto en el repo, el estado aquí. Una tarea marcada
 * desde la pantalla se pinta en Resuelto sin tocar los `.md`, y al desmarcarla
 * vuelve a Pendiente.
 *
 * ⚠️ LA CLAVE ES EL TÍTULO NORMALIZADO, y eso tiene una consecuencia que hay que
 * saber: si alguien reescribe el título de una tarea en el fichero, esta fila se
 * queda huérfana y la tarea vuelve a salir donde diga el fichero. Es el precio
 * de no meter identificadores dentro del markdown, que lo volvería ilegible y
 * obligaría a inventarlos a mano al escribir una tarea nueva. Una fila huérfana
 * no molesta a nadie: simplemente no casa con ninguna tarea.
 *
 * `resuelta` es un booleano NULLABLE a propósito, y son tres estados distintos:
 *   null   → manda el fichero (la tarea está donde esté escrita)
 *   true   → marcada aquí: sale en Resuelto aunque siga en `backlog.md`
 *   false  → reabierta aquí: sale en Pendiente aunque esté en `resuelto.md`
 * Una tarea solo asignada, sin tocar el tick, se queda en `null` y no se mueve.
 */
export function defineTableroEstado(sequelize) {
  return sequelize.define(
    "TableroEstado",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /** Título de la tarea normalizado (ver `claveDeTarea` en el endpoint). */
      clave: {
        type: DataTypes.STRING(200),
        allowNull: false,
        unique: true,
      },
      /** El título tal cual se leyó, para poder reconocer una fila huérfana. */
      titulo: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** "rodrigo" | "jorge" | null. Lista cerrada, validada en el endpoint. */
      asignadoA: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      resuelta: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      /** Quién fue la última persona que la tocó, para poder preguntarle. */
      tocadaPor: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "tablero_estado",
    }
  );
}
