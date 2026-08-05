import { DataTypes } from "sequelize";

/**
 * SessionPack — el bono de sesiones de UNA persona (04/08/2026).
 *
 * Un `EventType` con `sessionsCount > 1` es un pack: se contrata una vez y da
 * derecho a N citas. Esta tabla es la instancia de ese pack para alguien
 * concreto: cuántas sesiones compró, cuándo y qué pagó.
 *
 * Por qué una fila y no un contador en la ficha del cliente: una misma persona
 * puede terminar un bono de 10 y comprar otro. Sin instancias, la sesión 11
 * sería «la 11 de un pack de 10», que no significa nada; con instancias, es la
 * 1 del segundo bono. Y además queda el histórico de lo que compró y cuándo.
 *
 * ── LA CLAVE ES EL EMAIL ────────────────────────────────────────────────────
 * `clientEmail`, igual que en `ClientNotice` y en las reservas: el portal
 * identifica por correo verificado (SSO), y hay gente que reserva desde la web
 * sin tener ficha creada todavía. `clientId` se rellena cuando se sabe, para
 * poder enseñar el bono en la ficha, pero NO es lo que ata las citas al pack.
 *
 * Las sesiones consumidas NO se guardan aquí: se cuentan desde las reservas
 * (`lib/citas/packs.js`). Un contador que hay que acordarse de subir y bajar en
 * cada cancelación, reprogramación o falta acaba mintiendo; las citas son la
 * verdad y siempre están.
 */
export function defineSessionPack(sequelize) {
  return sequelize.define(
    "SessionPack",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * Foto de cuántas sesiones daba el pack al comprarlo.
       *
       * Copiada de `EventType.sessionsCount` a propósito: si mañana la
       * profesional cambia el programa de 10 a 12 sesiones, quien compró un 10
       * tiene 10. Leerlo del tipo de cita reescribiría hacia atrás lo que
       * alguien compró.
       */
      totalSessions: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      /** 'upfront' (pago único) | 'instalment' (fraccionado por meses). */
      pricingMode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "upfront",
      },
      /** Importe TOTAL comprometido, en céntimos. Cuota × meses si es a plazos. */
      amount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      /** Cuota mensual y meses, solo si se fraccionó. Para poder explicarlo después. */
      instalmentAmount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      instalmentMonths: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      /** El cobro que lo compró, si se pagó online. */
      paymentSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /**
       * De dónde salió el bono (05/08/2026).
       *
       * 'online' — lo creó el webhook de Stripe al confirmarse el pago. Era el
       *            único camino que existía.
       * 'manual' — lo dio de alta la profesional porque cobró por fuera de la
       *            pasarela: transferencia desde el extranjero, Bizum, PayPal.
       *
       * Se guarda porque son dos cosas muy distintas cuando algo va mal. Un bono
       * `online` tiene un cobro detrás que se puede mirar en Stripe; uno
       * `manual` solo tiene la palabra de quien lo creó, y por eso se audita y
       * se queda con su nombre en `createdBy`.
       */
      origin: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "online",
      },
      /** Quién lo dio de alta a mano. Vacío en los que vienen de un pago online. */
      createdBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      purchasedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      /**
       * 'active'   — quedan sesiones por usar
       * 'agotado'  — se han usado todas (lo marca el cálculo, no se toca a mano)
       * 'anulado'  — el centro lo cancela (devolución, error). Deja de descontar.
       */
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "active",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "session_packs",
      indexes: [
        // La consulta de cada reserva: «¿tiene esta persona bono de este tipo?».
        { fields: ["client_email", "event_type_id", "status"], name: "session_packs_email_type_idx" },
        { fields: ["client_id"], name: "session_packs_client_idx" },
      ],
    }
  );
}
