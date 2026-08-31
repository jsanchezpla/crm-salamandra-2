import { DataTypes } from "sequelize";

/**
 * Taller — actividad de grupo a la que se apunta quien quiere.
 *
 * Sale de la migración de Aumenta (02/08/2026). En Organízate, «H.H.S.S.»
 * (Habilidades Sociales) figuraba como una ESPECIALIDAD más, junto a Psicología
 * o Logopedia, y así iba a importarse. Rodrigo lo corrigió: *«es un taller que
 * tienen»*. No es poca cosa — son **4.287 citas** del historial.
 *
 * ── Por qué un taller NO es una especialidad ───────────────────────────────
 *
 * Una especialidad describe QUÉ hace un profesional y se asigna a la terapeuta
 * y al paciente. Un taller es una actividad concreta, con nombre propio, a la
 * que la familia **decide apuntarse**: puede haber varios a la vez, cambiar
 * cada curso, y un paciente puede estar en dos o en ninguno.
 *
 * Meterlo en la lista de especialidades habría contaminado esa taxonomía —que
 * comparten TODOS los tenants clínicos— con algo que solo es de Aumenta, y
 * habría impedido dar de alta un taller nuevo sin tocar código.
 *
 * Pendiente y deliberadamente fuera de aquí: que la web pueda leerlos o
 * inscribir (lo pidió Rodrigo «para el futuro»).
 */
export function defineTaller(sequelize) {
  return sequelize.define(
    "Taller",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Quién lo lleva. Nullable: un taller se puede dar de alta antes de
      // decidir quién lo imparte.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Texto libre («Martes 17:00», «Quincenal»). NO es un horario de verdad
      // con plazas y reservas: los talleres de Aumenta se organizan a mano y
      // montar un motor de citas para esto sería inventarse un problema.
      schedule: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      // El concepto del catálogo (billing_concepts) con el que se cobra este
      // taller (31/08/2026): al inscribir a un paciente la pantalla dice qué
      // se le cobrará. Sin FK dura a propósito — borrar el concepto no debe
      // romper el taller — y nullable: un taller puede no cobrarse.
      conceptId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Se desactiva en vez de borrarse: sus inscripciones históricas siguen
      // apuntando aquí y borrarlo dejaría el histórico sin nombre.
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "talleres",
      indexes: [
        { fields: ["active"], name: "talleres_active_idx" },
        { fields: ["name"], name: "talleres_name_idx" },
      ],
    }
  );
}
