import { DataTypes } from "sequelize";

/**
 * Booking — reserva de cita.
 *
 * Sprint 1: solo creación manual por el admin del tenant.
 * Sprint 2: la landing pública crea bookings con `cancellationToken` usable
 * para que el cliente cancele desde el email de confirmación.
 *
 * Notas:
 *   - `duration` y `meetUrl` se snapshotean al crear (no se recalculan si el
 *     EventType cambia después).
 *   - El campo `cancellationToken` se genera automáticamente; se usará en
 *     Sprint 2 al integrar emails.
 *   - Estados `cancelled` y `no_show` NO bloquean el slot horario; las
 *     validaciones de solapamiento se hacen a nivel de endpoint.
 */
export function defineBooking(sequelize) {
  return sequelize.define(
    "Booking",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      clientName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      clientEmail: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },
      clientPhone: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      additionalData: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      scheduledAt: {
        type: DataTypes.DATE, // TIMESTAMP WITH TIME ZONE
        allowNull: false,
      },
      // Snapshot de la duración del EventType al crear el booking
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },
      modality: {
        type: DataTypes.ENUM("presencial", "phone", "online"),
        allowNull: false,
      },
      // Snapshot del meet URL si modality='online'
      meetUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // 'pending' (Sprint Fase 1 nutri_laura) → bookings que esperan
      // confirmación manual del admin (lista de espera). Se ajusta el
      // default vía endpoint/tenant flag, no aquí: el modelo conserva
      // 'confirmed' como default para que la creación manual del admin
      // siga llegando ya confirmada.
      status: {
        type: DataTypes.ENUM("pending", "confirmed", "completed", "cancelled", "no_show"),
        allowNull: false,
        defaultValue: "confirmed",
      },
      // Uso futuro Sprint 2 (cancelación desde email)
      // Cuándo se envió el recordatorio de la víspera. NULL = todavía no.
    // Es lo que impide que cada pasada del temporizador reenvíe el mismo aviso.
    reminderSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancellationToken: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancellationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // ── Faltas de asistencia (sprint Aumenta 2026-07-28) ────────────────
      // Solo tienen sentido con status='no_show'. Tri-estado: null = falta
      // sin clasificar (citas antiguas), true = justificada, false = no
      // justificada. El motivo es texto libre opcional.
      noShowJustified: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      noShowReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Miembro del equipo (profesional) asignado a la cita. Nullable/aditivo:
      // las citas existentes (incl. nutri_laura en prod) quedan sin asignar.
      // underscored global → columna team_member_id.
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Paciente al que corresponde la cita (Aumenta: el que paga puede tener
      // varios pacientes/hijos; la cita se agenda para uno concreto). Nullable/
      // aditivo: las citas existentes quedan sin paciente. FK → patients SET NULL
      // solo en tenants con tabla patients (la migración lo aplica condicional).
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Ficha de cliente a la que pertenece esta cita (2026-07-22).
      //
      // Hasta ahora el cruce ficha↔citas se hacía comparando cadenas de email,
      // y eso se rompe en cuanto la persona escribe el correo con otra
      // mayúscula o se lo cambia: sus citas se le despegan de la ficha. Ahora
      // hay enlace de verdad.
      //
      // Nullable a propósito: una reserva pública de alguien que todavía NO es
      // cliente es perfectamente válida y no debe bloquearse. La FK va con
      // ON DELETE SET NULL — borrar una ficha nunca puede llevarse por delante
      // el histórico de citas, que tiene valor contable y clínico.
      //
      // client_name/email/phone SE QUEDAN: son la foto del momento de la
      // reserva y es lo que se imprime y se envía por correo.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // ── Cobro online (sprint pagos) ─────────────────────────────────────
      //
      // Va SEPARADO de `status` a propósito: `status` es la agenda (¿va a venir?)
      // y `paymentStatus` es el dinero (¿está pagada?). Mezclarlos metería
      // "esperando pago" en la lista de espera del profesional, que es otra cosa.
      //
      // `none` = cita sin cobro (tipo de cita gratuito, o creada a mano desde el
      // dashboard). Es el valor de TODAS las citas existentes: nada cambia para
      // los tenants que no cobran.
      paymentStatus: {
        type: DataTypes.ENUM("none", "pending", "paid", "refunded", "failed"),
        allowNull: false,
        defaultValue: "none",
      },
      // Importe EN CÉNTIMOS, copiado del EventType al reservar. Es una foto: si
      // el profesional cambia la tarifa después, esta cita conserva lo que se
      // cobró de verdad.
      amount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Hasta cuándo esta reserva provisional bloquea el hueco. Mientras
      // paymentStatus='pending' y esta fecha no haya pasado, el hueco está
      // ocupado; cuando pasa, se libera solo (ver ocupaHuecoWhere en
      // lib/citas/booking.js). Así un carrito abandonado no deja el hueco muerto
      // ni depende de que un cron funcione.
      holdExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      paymentSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Notas internas (no visibles al cliente)
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "bookings",
      indexes: [
        { fields: ["scheduled_at", "status"], name: "bookings_scheduled_status_idx" },
        { fields: ["client_email"], name: "bookings_client_email_idx" },
        { fields: ["team_member_id"], name: "bookings_team_member_idx" },
        { fields: ["patient_id"], name: "bookings_patient_idx" },
      ],
    }
  );
}
