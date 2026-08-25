import { DataTypes } from "sequelize";

/**
 * PatientTherapist — QUIÉN LLEVA A ESTE PACIENTE. Una fila por persona.
 *
 * ⚠️ ESTA TABLA ES LA LISTA COMPLETA, no «los otros». El de referencia también
 * tiene su fila aquí. Quién es el de referencia lo dice `patients.main_therapist_id`,
 * que se queda donde estaba.
 *
 * ── DE QUÉ PETICIÓN REAL NACE (Lau, Aumenta, 14/08/2026) ────────────────────
 *
 * «En los pacientes que tienen dos terapias, cómo meter a los 2 terapeutas que
 * tiene, porque me sale la opción solo para seleccionar 1 y lo llama terapeuta
 * principal.»
 *
 * No era hipotético: medido en producción el 25/08/2026, 15 pacientes de Aumenta
 * ya tienen citas repartidas entre dos o tres profesionales distintos (máximo 3),
 * y hasta hoy la ficha obligaba a elegir cuál de ellos «contaba». El resto del
 * CRM lee `main_therapist_id` —el filtro del listado, el reparto de planes, el
 * autorrelleno del profesional al crear una cita—, así que la segunda terapia
 * quedaba fuera de todo lo que se calculara por terapeuta.
 *
 * ── POR QUÉ NO SE SUSTITUYE `main_therapist_id` ────────────────────────────
 *
 * Porque hay ~20 sitios que lo leen y porque sigue significando algo que una
 * lista no sabe decir: cuál es la de referencia, a quién llama la familia y
 * quién firma por defecto. Es el mismo patrón que ya usa `lib/clients/contactMethods.js`
 * con los contactos múltiples de un cliente: la tabla tiene todos y el principal
 * se refleja en la columna de siempre.
 *
 * **EL INVARIANTE, en una frase**: si esta tabla tiene filas de un paciente,
 * `main_therapist_id` es UNA de ellas. Si no tiene ninguna, `main_therapist_id`
 * manda solo. Lo mantiene un único escritor, `sincronizarTerapeutas` de
 * `lib/clinica/terapeutas.js`, y por eso NO hay que rellenar nada para
 * desplegar: un paciente sin filas aquí se lee como «tiene al de la columna».
 *
 * Consecuencia buscada: `lib/clients/urgentes.js` no se toca. «Pacientes sin
 * terapeuta» sigue siendo `main_therapist_id IS NULL` y sigue queriendo decir
 * exactamente eso, incluidas las 614 filas de Aumenta y la carpeta que bloquea.
 *
 * ── LO QUE NO LLEVA, Y ES A PROPÓSITO ──────────────────────────────────────
 *
 * · `is_primary` — lo dice la columna de siempre, y no se dice dos veces.
 * · `role` (tutor / apoyo) — nadie lo ha pedido. Si llega, es un ALTER aditivo.
 * · `ended_at` / histórico — esto es «quién lo lleva HOY». Quién lo llevaba en
 *   marzo se responde por las sesiones, que ya guardan su `therapist_id`.
 *
 * ⚠️ Y una que hay que tener escrita porque se va a pedir: **esto es un dato de
 * la ficha, NO un control de acceso**. Que una terapeuta no esté en la lista de
 * un paciente no le impide ver su ficha. Si algún día se quiere que lo impida,
 * eso es una regla de visibilidad y va donde van esas —con su prueba—, no aquí:
 * el precedente entero está en `lib/citas/visibilidad.js`.
 */
export function definePatientTherapist(sequelize) {
  return sequelize.define(
    "PatientTherapist",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Ficha de equipo. Es `team_members`, no `users`: quien atiende puede no
      // tener login (el resto del módulo clínico ya lo hace así).
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * QUÉ le da esta persona a este paciente: la clave de
       * `lib/clinica/specialties.js` (`logopedia`, `psicologia`…). Nulo = «lo
       * lleva», sin precisar.
       *
       * Es lo que hace que la lista signifique algo. Lau no pidió «dos nombres»:
       * pidió los dos de un paciente con DOS TERAPIAS, y sin esto la pantalla no
       * puede decir cuál es cuál. Texto y no ENUM porque la taxonomía vive en
       * `lib/` y se amplía sin migración.
       */
      specialty: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      /**
       * Desde cuándo la lleva. Se CONSERVA al guardar: el escritor hace un diff
       * (borra los que se van, inserta los que llegan) y no toca a los que
       * siguen. Si arrasara y volviera a crear, todas las filas quedarían con la
       * hora del último guardado y este campo no valdría para nada — es un fallo
       * que se ve en la revisión y no en la pantalla.
       */
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "patient_therapists",
      indexes: [
        // Una persona, una fila por paciente. Es lo que hace idempotente el
        // guardado y lo que deja usar ON CONFLICT DO NOTHING al rellenar.
        { fields: ["patient_id", "team_member_id"], name: "patient_therapists_unique", unique: true },
        // «¿Qué pacientes lleva esta persona?» — el filtro del listado.
        { fields: ["team_member_id"], name: "patient_therapists_team_idx" },
      ],
    }
  );
}
