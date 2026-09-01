import { DataTypes } from "sequelize";

/**
 * Cuota — lo que una familia paga TODOS los meses (01/09/2026, petición de
 * Aumenta: «cómo crear cuotas para grupos de pacientes y programarlas
 * mensualmente»).
 *
 * ── Qué es y qué NO es ─────────────────────────────────────────────────────
 * `BillingConcept` es el CATÁLOGO («Logopedia 60x2 · 190 €»): el precio de la
 * casa. Esto es la ASIGNACIÓN: qué conceptos paga esta familia, por qué
 * paciente, con qué método y desde cuándo. El catálogo se toca una vez al año;
 * las asignaciones cambian cada semana (altas, bajas, cambios de terapia).
 *
 * Antes de esto la cuota vivía en `clients.cuota_concept_ids` —una lista de
 * conceptos que el CRM APRENDÍA del último cobro—, que sirve para rellenar el
 * drawer pero no sabe decir quién debe pagar este mes: no tiene ni fecha de
 * alta, ni baja, ni paciente, ni método. Aquella sigue viva y se re-aprende
 * sola; esta es la que se puede programar.
 *
 * ── Por qué el importe puede ser NULL ──────────────────────────────────────
 * NULL = «lo que digan sus conceptos» (la suma del catálogo), y así una subida
 * de precio se aplica cambiando UN concepto en vez de 300 filas. Con un número
 * escrito manda ese número: es el precio pactado con esa familia y no se mueve
 * aunque suba la tarifa. Las dos cosas hacen falta.
 *
 * La baja NO borra: se pone `endDate` (y `active` a false). Una cuota borrada
 * se lleva por delante la explicación de por qué se cobró lo que se cobró.
 */
export function defineCuota(sequelize) {
  return sequelize.define(
    "Cuota",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      // Quién paga. Es el destinatario de la factura, y por eso NOT NULL:
      // una cuota sin pagador no se puede ni cobrar ni facturar.
      clientId: { type: DataTypes.UUID, allowNull: false, field: "client_id" },
      // De qué niño es. Opcional: en nutrición el paciente ES el cliente, y en
      // un centro sin módulo asistencial no hay pacientes que enganchar.
      patientId: { type: DataTypes.UUID, allowNull: true, field: "patient_id" },
      // Los conceptos del catálogo que la componen (ids). Varios: dos hermanos,
      // cuota + descuento, logopedia + psicología.
      conceptIds: { type: DataTypes.JSONB, allowNull: true, field: "concept_ids" },
      // Importe mensual pactado. NULL = la suma de sus conceptos (ver cabecera).
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      // Con qué se cobra habitualmente. Es lo que permite lanzar «solo las de
      // banco» y lo que hereda el cobro generado.
      method: {
        type: DataTypes.ENUM("card", "transfer", "cash", "direct_debit"),
        allowNull: true,
      },
      // Día del mes en que se pasa el recibo (orientativo, 1-31). Se recorta al
      // último día del mes: un 31 en febrero sería una fecha inexistente.
      dayOfMonth: { type: DataTypes.INTEGER, allowNull: true, field: "day_of_month" },
      // Desde cuándo se cobra. El mes de alta se prorratea por días.
      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: "start_date" },
      // Hasta cuándo (la baja). NULL = sigue vigente.
      endDate: { type: DataTypes.DATEONLY, allowNull: true, field: "end_date" },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "billing_cuotas",
      indexes: [
        { fields: ["client_id"], name: "billing_cuotas_client_idx" },
        { fields: ["patient_id"], name: "billing_cuotas_patient_idx" },
        { fields: ["active"], name: "billing_cuotas_active_idx" },
      ],
    }
  );
}
