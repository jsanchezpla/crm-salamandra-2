import { DataTypes } from "sequelize";

/**
 * MailingContact — un correo SUELTO de la lista de mailing: alguien que no es
 * (o no es todavía) una ficha de cliente. La persona de la charla que dejó su
 * correo en una hoja, la que se apuntó en la web, la importada de un CSV.
 *
 * Decisión 1.2 del plan del módulo (23/08/2026): la lista se cuelga de lo que
 * ya existe. Los clientes que aceptaron «novedades» NO se copian aquí: el
 * módulo lee su casilla en `clients.communication_prefs`
 * (`lib/clients/comunicaciones.js`). Si se copiaran habría dos verdades sobre
 * quién ha aceptado publicidad y el día que discrepen mandará la equivocada.
 * Aquí viven SOLO los que no son de ninguna ficha, con su propio
 * consentimiento.
 *
 * `consentimiento` guarda la misma prueba que la casilla del cliente:
 *   { granted, at, ip, userAgent, by, origen }
 *   by ∈ "equipo" (lo apuntó el centro) | "csv" (venía en la importación)
 *        | "confirmacion" (la persona pinchó el correo de confirmación)
 *   origen: texto libre («hoja de la charla del 12/05»), lo que exige el RGPD
 *           para poder decir de dónde salió ese sí.
 *
 * `estado`:
 *   pendiente  se le ha mandado (o se le va a mandar) el correo de confirmación
 *              y aún no ha pinchado: NO recibe campañas
 *   activo     puede recibir
 *   baja       pidió salir (además está en `mailing_suppressions`)
 */
export function defineMailingContact(sequelize) {
  return sequelize.define(
    "MailingContact",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      // Siempre en minúsculas y sin espacios (lib/mailing/bajaToken.js normalizarEmail).
      email: { type: DataTypes.STRING(255), allowNull: false },
      nombre: { type: DataTypes.STRING(160), allowNull: true },
      origen: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "manual" }, // manual | csv | web
      consentimiento: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
      confirmadoAt: { type: DataTypes.DATE, allowNull: true },
      confirmacionEnviadaAt: { type: DataTypes.DATE, allowNull: true },
      notas: { type: DataTypes.TEXT, allowNull: true },
      // Referencia lógica al email de quien lo apuntó (master.users), sin FK.
      createdBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_contacts",
      indexes: [
        { unique: true, fields: ["email"], name: "mailing_contacts_email_uq" },
        { fields: ["estado"], name: "mailing_contacts_estado_idx" },
      ],
    }
  );
}
