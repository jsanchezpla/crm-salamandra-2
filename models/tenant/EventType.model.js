import { DataTypes } from "sequelize";

/**
 * EventType — tipo de cita configurable por el tenant.
 *
 * Cada EventType describe un servicio que se puede reservar (p. ej. "Primera
 * consulta", "Seguimiento"). Incluye duración, buffers, modalidades aceptadas
 * (presencial / phone / online) y reglas de antelación.
 *
 * Sprint 1: gestión interna por admin del tenant.
 * Sprint 2: la landing pública lee `active` y `modalities`.
 */
export function defineEventType(sequelize) {
  return sequelize.define(
    "EventType",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 480 },
      },
      bufferBefore: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      bufferAfter: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      color: {
        type: DataTypes.STRING(7),
        allowNull: true,
      },
      // Subset de ['presencial','phone','online'], mínimo 1
      modalities: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ["online"],
      },
      // Datos por modalidad (snapshot al crear booking)
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      meetUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Etiqueta y obligatoriedad del campo libre para el cliente
      additionalDataLabel: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      additionalDataRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Reglas de antelación (para Sprint 2 — la landing las usa)
      minNoticeHours: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
        validate: { min: 0 },
      },
      maxAdvanceDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60,
        validate: { min: 1 },
      },
      // Precio EN CÉNTIMOS (ver lib/payments/money.js). null o 0 = cita gratuita:
      // el flujo de reserva no pide pago, que es como siguen funcionando los
      // tenants que no cobran online.
      //
      // Con `sessionsCount > 1` este es el precio del PACK ENTERO pagado de una
      // vez, no el de una sesión suelta.
      price: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      /**
       * Cuántas sesiones incluye contratar esto (04/08/2026).
       *
       * 1 = una cita suelta, que es como ha funcionado siempre. Más de 1 es un
       * PACK: se paga una vez y da derecho a N citas, que se van reservando por
       * separado y llevan su número («3 de 10»).
       */
      sessionsCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: { min: 1, max: 200 },
      },
      /**
       * Precio del pago FRACCIONADO, en céntimos y POR MES.
       *
       * Es un precio independiente, no `price` dividido: financiar cuesta más y
       * 3 × 130 € = 390 € frente a 360 € de golpe (ejemplo de Rodrigo). Se
       * guarda la cuota mensual y no el total porque la cuota es lo que la
       * profesional decide y lo que la paciente ve anunciado.
       *
       * null = este tipo de cita no se puede fraccionar.
       */
      instalmentPrice: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      /** En cuántos meses se fracciona. El total es cuota × meses. */
      instalmentMonths: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 2, max: 36 },
      },
      /**
       * Formulario que hay que rellenar DESPUÉS de elegir fecha y hora
       * (04/08/2026). Apunta a un `Form`, el mismo constructor que ya usa la
       * bandeja de solicitudes. null = este tipo de cita no pide nada.
       *
       * ⚠️ NO confundir con la PUERTA DE ADMISIÓN (`lib/citas/puertaFormulario.js`):
       * aquella exige un formulario ACEPTADO antes de dejar reservar, es de todo
       * el centro y va de «¿te admito como paciente?». Esto es un paso más de la
       * reserva de UN tipo de cita concreto.
       */
      formId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * Preguntas que se contestan al reservar ESTE tipo de cita (04/08/2026).
       *
       * Sustituyen a `formId`: las preguntas viven aquí y no en un formulario
       * del módulo Formularios, que obligaba a salir de esta pantalla y a tener
       * ese módulo contratado para pedir un dato. Cuatro clases —número, escala
       * de círculos, texto corto y texto largo—; el contrato está en
       * `lib/citas/preguntasCita.js`.
       */
      formQuestions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      /**
       * «Esta es la valoración inicial» (04/08/2026, Rodrigo).
       *
       * A la valoración inicial se entra SIN firmar nada: es la primera visita,
       * cuando la persona todavía no ha decidido si empieza. Exigirle el
       * contrato del centro para conocer a la nutricionista espantaba gente en
       * la puerta.
       *
       * Es una MARCA del tipo de cita y no el nombre «Valoración inicial»
       * escrito en el código: cada centro llama a su primera visita como
       * quiere, y un rótulo que alguien renombre un martes no puede decidir
       * quién se salta un contrato.
       *
       * Solo debería estar marcado UNO por tenant; el endpoint desmarca el
       * anterior al marcar otro.
       */
      isInitialAssessment: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /**
       * Oculto en la agenda pública (05/08/2026, Rodrigo).
       *
       * `active` dice si el tipo de cita SIRVE; esto dice QUIÉN lo ve. Un tipo
       * oculto no sale en el widget para nadie: solo lo ve —y solo lo puede
       * reservar— quien tenga un BONO ACTIVO suyo, que se le da a dedo desde su
       * ficha (`lib/citas/tiposVisibles.js`).
       *
       * Para qué: hay pacientes que pagan por fuera de la pasarela (transferencia
       * desde el extranjero, Bizum) y su cita figura como gratuita en el sistema
       * porque el dinero ya entró. Si ese tipo estuviera a la vista, cualquiera
       * podría colarse y no se notaría hasta la quinta sesión sin pagar.
       *
       * NO se usa `active: false` para esto: un tipo desactivado no lo puede
       * reservar nadie, tampoco la persona a la que sí le corresponde.
       */
      isHidden: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /**
       * ── ESTE TIPO DE CITA ES UN TALLER (01/09/2026, Aumenta por Rodrigo) ──
       *
       * «Hay que preparar los talleres de tal forma que en las citas se pueda
       * seleccionar los talleres. No como bloqueos sino como un tipo más de
       * cita. **Solo que estos tipos de cita se crean desde la pestaña de
       * talleres.**»
       *
       * Apunta al grupo (`taller_grupos`), no a la actividad: lo que se apunta
       * en la agenda es «Habilidades sociales · Grupo A», con su hora, su gente
       * y quien lo da. Un tipo de cita por grupo.
       *
       * ── POR QUÉ EL PUNTERO ESTÁ AQUÍ Y NO EN EL GRUPO ────────────────────
       * Porque la pregunta que se hace mil veces al día es la de ida: el
       * desplegable de tipos de cita, el calendario y el alta de una cita
       * necesitan saber, de un tipo cualquiera, si es un taller. Con el puntero
       * en el grupo eso serían dos consultas en cada pantalla de agenda —y en
       * los tenants sin Clínica, una consulta a una tabla que no existe—. Al
       * revés se lee de la fila que ya está cargada.
       *
       * Sin FK dura, y esto no es la coartada de siempre: `taller_grupos` es
       * del módulo Clínica y `event_types` del de Citas, así que hay schemas
       * con esta tabla y sin aquella. Una FK de verdad no se podría ni crear.
       *
       * Null en los 62 tipos de cita de Aumenta y en los de todos los demás:
       * un tipo sin esto se comporta exactamente como antes de que existiera.
       */
      tallerGrupoId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /*
       * El concepto del catálogo —lo que Aumenta llama «la cuota»— que cubre
       * las citas de este tipo (04/09/2026). Se pone UNA vez aquí y baja solo
       * a cada cita nueva, que es lo que hace que la regla no cueste un clic
       * más en las ~250 citas que se apuntan al día. En el alta se puede
       * cambiar. Ver `lib/citas/dineroDeLaCita.js`.
       *
       * No confundir con `price`, que es el precio para COBRAR CON TARJETA en
       * el widget público: ponerlo ahí abriría la caja a las familias.
       *
       * Sin FK, por lo mismo que `tallerGrupoId`: hay schemas con
       * `event_types` y sin módulo de facturación.
       */
      conceptId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "concept_id",
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "event_types",
      indexes: [
        { unique: true, fields: ["slug"], name: "event_types_slug_unique" },
        { fields: ["active", "order"], name: "event_types_active_order_idx" },
      ],
    }
  );
}
