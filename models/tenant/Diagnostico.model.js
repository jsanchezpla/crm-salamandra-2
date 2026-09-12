import { DataTypes } from "sequelize";
import { ESTADOS } from "../../lib/clinica/diagnostico.js";

/**
 * Diagnostico — el EXPEDIENTE de diagnóstico de un paciente (12/09/2026,
 * Rodrigo con Isa, Aumenta).
 *
 * Un diagnóstico es un producto cerrado de horas —simple: 10 h (1 de
 * entrevista + 9); completo: 20 h (1 + 19)— con un terapeuta asignado y una
 * barra de horas que se CALCULA desde las citas. Aquí vive lo que no se puede
 * deducir de ellas: de quién es, qué producto contrató, cuál es su tope, en qué
 * estado está y qué filas de otros módulos le pertenecen. Las reglas —qué
 * cuenta como hora, a qué estado se puede pasar— están en
 * `lib/clinica/diagnostico.js`, que es puro y lo lee también el navegador.
 *
 * ── LAS HORAS NO SE GUARDAN, SE CUENTAN ─────────────────────────────────────
 * No hay «horas hechas» aquí, y es la misma decisión que en los bonos
 * (`SessionPack.model.js`): un contador hay que acordarse de moverlo en cada
 * cancelación, reprogramación y falta, y basta olvidar uno para que mienta.
 * Lo único que se guarda es el TOPE (`horasMax`), que es una decisión de
 * alguien: nace del producto y solo lo sube dirección o administración
 * («Desbloquear horas»), con quién y cuándo al lado.
 *
 * ── SIN FK DURAS, A PROPÓSITO (patrón `taller_grupo_id`) ────────────────────
 * Apunta a `patients`, `clients`, `team_members`, `event_types`,
 * `billing_concepts`, `session_packs`, `bookings` y `clinical_reports`, y hay
 * schemas con unas tablas y sin otras (Citas sin Clínica, Clínica sin
 * Facturación). Una FK de verdad no se podría crear en todos, y borrar un
 * concepto del catálogo o un tipo de cita no puede llevarse por delante el
 * expediente de un niño. Los punteros se quedan colgando y la pantalla lo dice.
 */
export function defineDiagnostico(sequelize) {
  return sequelize.define(
    "Diagnostico",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      /** De qué paciente es. Es lo único que no puede faltar: sin paciente no hay expediente. */
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /** La familia que paga: foto del `clientId` del paciente al abrirlo, como en las sesiones. */
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /** El terapeuta asignado en general (cada cita lleva el suyo). Se cambia desde la lista. */
      therapistId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * Qué producto contrató: la `key` de `productosDe(tenant)` («simple»,
       * «completo» o uno propio del centro) y su nombre en ESE momento. El
       * nombre es foto: si el centro renombra el producto, el expediente de
       * hace un año sigue diciendo lo que se contrató.
       */
      productoKey: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      productoNombre: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      /**
       * El TOPE de horas de este expediente: nace de las del producto (10 o
       * 20) y solo sube desde «Desbloquear horas». DECIMAL porque las horas van
       * de media en media; el getter lo devuelve como número porque el driver
       * lo entrega como texto y una barra que compara «10.0» con 9,5 miente.
       */
      horasMax: {
        type: DataTypes.DECIMAL(5, 1),
        allowNull: false,
        get() {
          const v = this.getDataValue("horasMax");
          return v === null || v === undefined ? null : Number(v);
        },
      },
      /** Quién subió el tope por última vez y cuándo. NULL = nunca se ha desbloqueado. */
      horasDesbloqueadasPor: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      horasDesbloqueadasAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      /** El tipo de cita DIAGNÓSTICO con el que se abren sus citas (foto, por si el centro tiene varios). */
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /** El concepto del catálogo con el que se cobró el producto al «Seguir». */
      conceptId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /** El bono SIN TOPE que nace al «Seguir» (`session_packs.total_sessions` a NULL). */
      packId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /** La cita de la entrevista inicial, cuando se abre desde el expediente. */
      entrevistaBookingId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * El COBRO de la entrevista inicial (fila de `payments`), atado por id
       * (12/09/2026, segunda entrega). La primera entrega lo encontraba por
       * nota + fecha (`cobrosDeExpedientes`), que valía para enseñarlo pero no
       * para DESCONTARLO: desde la respuesta de Aumenta, los 50 € de una
       * entrevista ya cobrada se restan del producto al «Seguir», y para
       * restar hay que saber sin adivinar cuál es. Lo escribe `parar` (el
       * cobro que nace) o el alta que adopta una entrevista ya hecha. Null en
       * los expedientes anteriores: para ellos sigue valiendo la búsqueda por
       * nota + fecha. Sin FK: hay Clínica sin Facturación, y anular un cobro
       * no puede llevarse el expediente.
       */
      entrevistaPaymentId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /** El informe de valoración diagnóstica al que se une (segunda entrega). */
      informeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * 'entrevista'  — abierto, con la entrevista inicial por dar o recién dada
       * 'no_continua' — la familia paró tras la entrevista (se cobra la entrevista)
       * 'en_curso'    — sigue: tiene su bono sin tope y su cobro pendiente
       * 'cerrado'     — cerrado a mano
       * Las transiciones las decide `puedePasarA` en `lib/clinica/diagnostico.js`.
       */
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "entrevista",
        validate: { isIn: [ESTADOS] },
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** Quién abrió el expediente (miembro del equipo). */
      createdById: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "diagnosticos",
      indexes: [
        { fields: ["patient_id"], name: "diagnosticos_patient_idx" },
        { fields: ["status"], name: "diagnosticos_status_idx" },
        { fields: ["therapist_id"], name: "diagnosticos_therapist_idx" },
      ],
    }
  );
}
