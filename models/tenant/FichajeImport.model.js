import { DataTypes } from "sequelize";

/**
 * FichajeImport — EL LOTE. Un volcado de Excel, con nombre y apellidos.
 *
 * Existe por una razón concreta: **un volcado tiene que poder deshacerse
 * entero**, no fila a fila. Cuando alguien sube el fichero equivocado —y va a
 * pasar— la única reparación aceptable es «quita todo lo que entró con ese
 * fichero», y para eso hay que saber qué entró con él.
 *
 * De aquí salen las tres defensas contra el duplicado:
 *
 * · `fileHash` (sha256 del fichero) da el aviso barato antes de tocar nada:
 *   «este fichero exacto ya se volcó el 3 de marzo, ¿seguro?».
 * · `periodo` permite el REEMPLAZO: aplicar el mes M marca el lote anterior de
 *   ese mes como `superseded` y hace soft-delete de sus filas —solo de las que
 *   vinieron del import; las correcciones a mano sobreviven—.
 * · `resumen` guarda los totales por persona TAL COMO QUEDARON ese día. Es la
 *   foto: si alguien discute una nómina tres meses después, aquí está lo que
 *   decía el sistema cuando se pagó, aunque después se corrigieran filas.
 *
 * `resumen` es lo único que se guarda calculado en todo el módulo, y es a
 * propósito: no es un contador que deba seguir vivo, es un acta de un momento.
 */
export function defineFichajeImport(sequelize) {
  return sequelize.define(
    "FichajeImport",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // 'YYYY-MM'. STRING y no DATE: es un mes, no un instante, y así se
      // compara y se agrupa sin cuidarse de zonas horarias.
      periodo: {
        type: DataTypes.STRING(7),
        allowNull: false,
        validate: { is: /^\d{4}-(0[1-9]|1[0-2])$/ },
      },
      fileName: { type: DataTypes.STRING(255), allowNull: true, field: "file_name" },
      fileHash: { type: DataTypes.STRING(64), allowNull: true, field: "file_hash" },
      // Qué parser leyó el fichero. El núcleo del módulo es universal y el
      // lector es de cada cliente, así que conviene saber con cuál se hizo:
      // cambiar el parser y no saber qué volcados vinieron del viejo es
      // quedarse sin poder explicar un número raro de hace dos meses.
      parser: { type: DataTypes.STRING(60), allowNull: true },
      rowsTotal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rows_total" },
      rowsOk: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rows_ok" },
      rowsError: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rows_error" },
      status: {
        type: DataTypes.ENUM("applied", "superseded", "reverted"),
        allowNull: false,
        defaultValue: "applied",
      },
      importedByTeamId: { type: DataTypes.UUID, allowNull: true, field: "imported_by_team_id" },
      importedByUserId: { type: DataTypes.UUID, allowNull: true, field: "imported_by_user_id" },
      appliedAt: { type: DataTypes.DATE, allowNull: true, field: "applied_at" },
      revertedAt: { type: DataTypes.DATE, allowNull: true, field: "reverted_at" },
      // Totales por persona en el momento del volcado + las anotaciones que
      // venían escritas en el Excel (BAJA, MÉDICO, JUSTIFICANTE…), que en el
      // fichero de Aumenta van en la misma columna que los nombres y se
      // perderían si solo se guardaran las horas.
      resumen: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: "fichaje_imports",
      indexes: [
        { fields: ["periodo"], name: "fichaje_imports_periodo_idx" },
        { fields: ["file_hash"], name: "fichaje_imports_hash_idx" },
      ],
    }
  );
}
