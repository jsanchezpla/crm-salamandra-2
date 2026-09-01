import { DataTypes } from "sequelize";

/**
 * TallerAsistencia — un paciente en UNA cita de taller: si fue, si faltó y por
 * qué (01/09/2026, Aumenta por Rodrigo).
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * Un taller es una cita a la que van ocho. En la agenda se pidió que fuese UNA
 * caja —no ocho apiladas a la misma hora—, así que la cita (`bookings`) no
 * lleva paciente: la lista de quién va vive aquí, una fila por asistente.
 *
 * Y la asistencia se marca uno a uno, como en una cita normal: «vino / faltó
 * justificada / faltó sin justificar». Sin esto, la falta de un niño a un
 * taller no existiría en ningún sitio — ni para reclamarla, ni para
 * recuperarla, ni para explicar por qué su registro de esa tarde no está.
 *
 * ── LOS ESTADOS SON LOS DE UNA CITA, A PROPÓSITO ────────────────────────────
 * `no_show` + `justified` + `reason` son EXACTAMENTE los tres campos de
 * `bookings` (sprint de faltas, 28/07/2026), con el mismo tri-estado y el mismo
 * significado. Es lo que permite que la falta a un taller entre por la misma
 * puerta que las demás: abre incidencia con `lib/citas/incidenciaPorFalta.js` y
 * se lee igual en la ficha del paciente.
 *
 *   · `prevista` → está apuntado y aún no se ha dicho nada. Es como nace.
 *   · `asistio`  → vino. Es a quien se le copia el registro de la sesión.
 *   · `no_show`  → faltó. `justified` null = sin clasificar, true/false = lo
 *     que decidió el centro.
 *
 * ── LO QUE ARRASTRA HACIA EL REGISTRO ───────────────────────────────────────
 * Al guardar la sesión del taller, el registro común se copia SOLO a los que
 * constan como `asistio` (`lib/clinica/propagarTaller.js`). Marcar una falta
 * después de haber escrito el registro le quita a ese paciente su copia, que es
 * lo correcto: no se le puede dejar en la historia clínica una sesión a la que
 * no fue.
 *
 * `clinic_sessions` NO se apunta aquí: el enlace ya existe al revés
 * (`clinic_sessions.taller_sesion_id` + `patient_id`), y duplicarlo daría dos
 * verdades que se pueden contradecir.
 */
export function defineTallerAsistencia(sequelize) {
  return sequelize.define(
    "TallerAsistencia",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      bookingId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * El grupo del que salió esta lista. Se guarda aunque se pueda deducir
       * por la cita: es el camino de «¿a cuántas sesiones de su grupo ha ido
       * este niño este trimestre?», que se pregunta desde la ficha del paciente
       * y desde el propio grupo, y sin esta columna serían dos saltos.
       */
      grupoId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("prevista", "asistio", "no_show"),
        allowNull: false,
        defaultValue: "prevista",
      },
      // Solo con sentido en `no_show`. Tri-estado, igual que en `bookings`:
      // null = falta sin clasificar, true = justificada, false = sin justificar.
      justified: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      noShowReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /**
       * La incidencia que abrió esta falta, si se abrió. Sin FK dura y
       * nullable: cerrar o borrar la incidencia no puede tocar la asistencia, y
       * la inmensa mayoría no abre ninguna.
       */
      incidenciaId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "taller_asistencias",
      indexes: [
        { fields: ["booking_id"], name: "taller_asistencias_booking_idx" },
        { fields: ["patient_id"], name: "taller_asistencias_patient_idx" },
        { fields: ["grupo_id"], name: "taller_asistencias_grupo_idx" },
      ],
    }
  );
}
