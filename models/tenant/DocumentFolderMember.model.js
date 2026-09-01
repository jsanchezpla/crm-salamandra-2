import { DataTypes } from "sequelize";

/**
 * DocumentFolderMember — «esta carpeta la ve también esta persona»
 * (01/09/2026, Rodrigo: «las carpetas creadas en Documentos tienen que poder
 * ser vistas por quien se quiera. Un selector de equipo»).
 *
 * ── EL HUECO QUE TAPA ───────────────────────────────────────────────────────
 * Hasta hoy una carpeta era `private` (solo su dueño) o `shared` (todo el
 * centro), sin nada en medio. No había forma de decir «los protocolos de
 * intervención los ven las cinco terapeutas y nadie más»: o se los quedaba una
 * o los veía hasta quien pasa facturas.
 *
 * ── POR QUÉ UNA TABLA Y NO UN VALOR MÁS EN `visibility` ────────────────────
 * Porque `document_folders.visibility` es un ENUM **de Postgres**, y ampliar un
 * enum en una migración de tenant es justo lo que ya mordió una vez (la lección
 * quedó escrita: VARCHAR + CHECK, nunca un valor nuevo en un enum vivo). Y
 * porque el dato no es «de qué clase es la carpeta» sino «quiénes son»: una
 * lista, que en una columna sería un array que hay que recorrer entero para
 * responder «¿qué carpetas veo yo?».
 *
 * `visibility` se queda EXACTAMENTE como está y esta tabla se suma:
 *
 *   · `private` sin lista   → solo el dueño (como siempre).
 *   · `private` con lista   → el dueño y los de la lista.   ← lo nuevo
 *   · `shared`              → todo el centro (como siempre).
 *
 * ── VER, NO ESCRIBIR ────────────────────────────────────────────────────────
 * Estar en la lista da LECTURA: se ve la carpeta, sus subcarpetas y sus
 * documentos, y se descargan. Subir, renombrar y borrar siguen siendo del
 * dueño. El encargo dice «vistas por quien se quiera» y eso es lo que hace; dar
 * escritura de propina es la clase de regalo que luego nadie sabe de dónde
 * salió.
 *
 * ── POR TEAM_MEMBER, COMO EL RESTO DE SELECTORES ───────────────────────────
 * El ACL de Documents va por `ownerUserId` (usuario de master) y esta lista por
 * `teamMemberId` (ficha del tenant), que es lo que elige un selector de equipo
 * —el mismo de las lecturas de documento—. El puente es `TeamMember.userId`, y
 * lo cruza `lib/documents/carpetasCompartidas.js` en un sitio y no en cinco.
 * Quien no tenga ficha de equipo no puede estar en ninguna lista: no aparece en
 * el selector y sigue viendo lo suyo y lo compartido de siempre.
 */
export function defineDocumentFolderMember(sequelize) {
  return sequelize.define(
    "DocumentFolderMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      folderId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "folder_id",
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "team_member_id",
      },
      // Quién la compartió (id de usuario de master). Nullable, como el resto
      // de `createdById` del CRM.
      addedById: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "added_by_id",
      },
    },
    {
      tableName: "document_folder_members",
      indexes: [
        { fields: ["folder_id", "team_member_id"], unique: true, name: "document_folder_members_unique" },
        // El camino de CADA carga del archivo: «¿qué carpetas me han
        // compartido a mí?». Va primero por persona a propósito.
        { fields: ["team_member_id"], name: "document_folder_members_member_idx" },
      ],
    }
  );
}
