import { DataTypes } from "sequelize";

/**
 * PaymentSession — un intento de cobro online contra una entidad del tenant.
 *
 * Es GENÉRICA a propósito: no está atada a citas. Cualquier módulo cobra por algo
 * suyo mediante el par `entityType` + `entityId` (mismo patrón que Notification).
 * El primer caso de uso son las citas de nutri_laura (`entityType: "booking"`),
 * pero sirve igual para pedidos o facturas sin tocar este modelo.
 *
 * NO se reutiliza el modelo `Payment` del módulo de facturación: aquel cuelga de
 * `invoiceId` (cobro de una factura ya emitida, registrado a mano) y aquí no hay
 * factura de por medio.
 *
 * DINERO EN CÉNTIMOS (INTEGER), nunca decimales: evita errores de redondeo en
 * coma flotante y es además lo que espera la API de Stripe.
 *
 * Los ids de Stripe son UNIQUE: es la primera barrera contra el doble cobro si un
 * webhook se reintenta (Stripe reintenta durante 3 días).
 */
export function definePaymentSession(sequelize) {
  return sequelize.define(
    "PaymentSession",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Qué se está pagando (referencia lógica, sin FK: la entidad vive en otra tabla)
      entityType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Importe EN CÉNTIMOS
      amount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "eur",
      },
      // 'authorizing' / 'authorized' / 'void' son del flujo de RETENCIÓN
      // (autorizar al reservar, capturar al confirmar). 'authorized' significa
      // que hay dinero apartado en la tarjeta del cliente que TODAVÍA NO ES
      // NUESTRO: no es un ingreso, no ha generado comisión, y se libera solo si
      // nadie lo captura. Cuidado al sumar importes para informes o facturas:
      // solo cuenta 'paid'.
      status: {
        type: DataTypes.ENUM(
          "pending",
          "authorizing",
          "authorized",
          "paid",
          "failed",
          "refunded",
          "expired",
          "void"
        ),
        allowNull: false,
        defaultValue: "pending",
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stripeCheckoutSessionId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      stripePaymentIntentId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Copia literal del `capture_before` de Stripe: cuándo caduca la retención.
      // Al caducar, el PaymentIntent queda muerto y no se puede capturar; hay que
      // autorizar de cero. Nunca se calcula por nuestra cuenta.
      authorizationExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Hueco reservado para el plan B (guardar la tarjeta y poder reintentar si
      // una retención caduca). Hoy NO se escribe ni se lee: está aquí para no
      // tener que migrar todos los tenants otra vez si se activa más adelante.
      stripeCustomerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stripeRefundId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      refundAmount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      refundedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      refundReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "payment_sessions",
      indexes: [
        { fields: ["entity_type", "entity_id"], name: "payment_sessions_entity_idx" },
        { fields: ["status"], name: "payment_sessions_status_idx" },
      ],
    }
  );
}
