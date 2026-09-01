import { DataTypes } from "sequelize";

/**
 * DocumentRead — «este documento TIENES QUE LEERLO tú» (01/09/2026, Rodrigo).
 *
 * Una fila por (documento, persona del equipo): quién tiene que leer qué, y
 * cuándo lo leyó. Es el acuse de lectura del archivo central.
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Cuando quiero subir un documento, quiero poder tagear a los miembros de mi
 * equipo para que les salte un aviso de que ese documento lo tienen que leer en
 * la pantalla de inicio.»
 *
 * ── POR QUÉ UNA TABLA Y NO UN CAMPO EN `documents` ──────────────────────────
 * Porque el dato NO es del documento, es del PAR documento-persona: el acta de
 * la reunión la han leído tres de los siete, y eso son siete estados distintos.
 * Un array JSONB en `documents` guardaría a quién se le pidió, pero no cuándo
 * lo abrió cada uno, y para saber si alguien lo tiene pendiente habría que
 * recorrer el array de TODOS los documentos en cada carga de la portada. Con
 * una fila por persona, «lo que me falta por leer» es un índice.
 *
 * Es el mismo patrón que `IncidenciaAssignee` y `TaskAssignee`: la lista de
 * personas de algo se guarda en su tabla pivote, no en una columna.
 *
 * ── POR QUÉ APUNTA AL TEAM_MEMBER Y NO AL USUARIO ──────────────────────────
 * Porque «los miembros de mi equipo» son las fichas de equipo: es lo que se
 * elige en la pantalla, lo que usan las incidencias y las tareas, y lo que la
 * portada ya resuelve para saber qué es «lo mío» (`miFichaDeEquipo`). El id de
 * usuario de master se resuelve al asignar, solo para tocar la campana
 * (`TeamMember.userId`), y no se guarda aquí: sería una segunda verdad que se
 * queda vieja en cuanto se reenlaza una ficha con otra cuenta.
 *
 * ── UNA PERSONA, UNA FILA ───────────────────────────────────────────────────
 * UNIQUE (document_id, team_member_id): pedir dos veces la misma lectura no
 * crea dos avisos ni borra el acuse del primero.
 *
 * `readAt` a NULL = pendiente. Se sella cuando la persona ABRE el documento
 * (descarga o vista previa) o pulsa «Marcar como leído»: leer es abrirlo, no
 * declararlo. Ver `lib/documents/lecturas.js`.
 */
export function defineDocumentRead(sequelize) {
  return sequelize.define(
    "DocumentRead",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      documentId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "document_id",
      },
      // A quién se le pide la lectura. FK a `team_members` (ON DELETE CASCADE
      // en la migración): si alguien deja el centro, sus lecturas pendientes se
      // van con su ficha — nadie tiene que leer nada ya.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "team_member_id",
      },
      // Quién la pidió (id de usuario de master, como `createdById` en el resto
      // del CRM). Nullable: una asignación automática no tiene autor.
      assignedById: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "assigned_by_id",
      },
      // NULL = pendiente. Con fecha = leído, y esa fecha es la respuesta a
      // «¿cuándo se enteró?», que es justo para lo que se pide un acuse.
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "read_at",
      },
    },
    {
      tableName: "document_reads",
      indexes: [
        { fields: ["document_id", "team_member_id"], unique: true, name: "document_reads_unique" },
        // El camino de la portada y de la bandeja: «lo que me falta por leer».
        // Parcial, porque lo leído deja de consultarse casi siempre.
        {
          fields: ["team_member_id"],
          name: "document_reads_pendientes_idx",
          where: { read_at: null },
        },
      ],
    }
  );
}
