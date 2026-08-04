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
