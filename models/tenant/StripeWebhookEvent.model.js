import { DataTypes } from "sequelize";

/**
 * StripeWebhookEvent — registro de los eventos de Stripe ya procesados.
 *
 * Existe por UNA razón: **que un cobro no se procese dos veces**. Stripe reintenta
 * cada evento hasta 3 días si no recibe un 200, y además puede entregar el mismo
 * evento más de una vez por diseño (garantiza "at least once", no "exactly once").
 * Sin esta tabla, un reintento podría confirmar dos veces una cita, o peor, disparar
 * un segundo reembolso.
 *
 * El `stripeEventId` es UNIQUE: el segundo intento de insertar el mismo evento
 * revienta contra el índice y el webhook lo trata como "ya visto" → no-op + 200.
 * Se apoya en la base de datos en lugar de en una comprobación previa en código
 * porque dos reintentos simultáneos pasarían los dos ese `if`.
 */
export function defineStripeWebhookEvent(sequelize) {
  return sequelize.define(
    "StripeWebhookEvent",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      stripeEventId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Resultado del procesado, para poder auditar sin volver a Stripe.
      outcome: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "stripe_webhook_events",
    }
  );
}
