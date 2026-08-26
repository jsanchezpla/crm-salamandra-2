import { DataTypes } from "sequelize";

/**
 * Estado que el Registro pone ENCIMA de una tarea del texto publicado.
 *
 * POR QUÉ UNA TABLA APARTE DEL TEXTO (12/08/2026, decisión de Rodrigo)
 * Nació cuando el texto del Registro eran dos `.md` que viajaban DENTRO de la
 * imagen de Docker: lo que la pantalla escribiera en ellos lo borraría el
 * siguiente despliegue. El estado que se cambia en caliente desde el móvil
 * —«esto es tuyo», «esto ya está»— necesitaba vivir en la base. Desde el
 * 19/08/2026 el TEXTO también vive en master (`tablero_documentos`, una fila
 * por versión), y el reparto sigue teniendo sentido por otro motivo: el texto
 * se publica entero, versión a versión, y el tick o el reparto de una tarea no
 * tienen por qué crear una versión nueva del documento.
 *
 * Una tarea marcada desde la pantalla se pinta en Resuelto sin tocar el texto,
 * y al desmarcarla vuelve a Pendiente.
 *
 * ⚠️ LA CLAVE ES EL TÍTULO NORMALIZADO, y eso tiene una consecuencia que hay que
 * saber: si alguien reescribe el título de una tarea en el texto, esta fila se
 * queda huérfana y la tarea vuelve a salir donde diga el texto. Es el precio
 * de no meter identificadores dentro del markdown, que lo volvería ilegible y
 * obligaría a inventarlos a mano al escribir una tarea nueva. Una fila huérfana
 * no molesta a nadie: simplemente no casa con ninguna tarea.
 *
 * `resuelta` es un booleano NULLABLE a propósito, y son tres estados distintos:
 *   null   → manda el texto (la tarea está donde esté escrita)
 *   true   → marcada aquí: sale en Resuelto aunque siga en el backlog
 *   false  → reabierta aquí: sale en Pendiente aunque esté en resuelto
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
      /**
       * Cómo se arregla, en texto libre, escrito desde la pantalla (14/08/2026).
       *
       * Vive aquí y no en el texto del Registro a propósito: es una nota entre
       * nosotros dos, no la tarea, y cuando se arregla de verdad lo que queda
       * escrito en resuelto es lo que se hizo, no lo que se pensaba hacer.
       */
      solucion: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /**
       * Cuándo se apuntó la tarea por primera vez (26/08/2026, Jorge: «que se
       * apunte la fecha de cuando se añadió la tarea y que se pueda ordenar por
       * fecha»).
       *
       * ⚠️ NO es `created_at`, que se le parece demasiado y está en esta misma
       * tabla: esa dice cuándo nació ESTA FILA, o sea la primera vez que alguien
       * tocó el tick, el reparto o la solución de la tarea — que puede ser días
       * después de escribirla, o no pasar nunca. Esta dice cuándo entró la tarea
       * en el Registro, que es lo que contesta «¿cuánto lleva esto ahí?».
       *
       * Se rellena sola: `sellarAltas` (lib/tablero/documentos.js) se la pone,
       * después de cada publicación, a las tareas que todavía no la tengan —
       * venga la publicación del tablero o de `scripts/registro.mjs`. Y NO se
       * sobrescribe NUNCA, que es lo que hace que cerrar una tarea (sale del
       * backlog, entra en resuelto) no la rejuvenezca.
       *
       * Las que ya estaban escritas el día que se añadió la columna no salen de
       * la nada: se reconstruyeron del historial de versiones de
       * `tablero_documentos` con `scripts/sembrar-fechas-de-alta.js`.
       */
      apuntadaEn: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "tablero_estado",
    }
  );
}
