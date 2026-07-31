import { DataTypes } from "sequelize";

export function defineClient(sequelize) {
  return sequelize.define(
    "Client",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM("individual", "company"),
        allowNull: false,
        defaultValue: "company",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      taxId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // ── Datos fiscales para facturación (relleno bajo demanda) ──────────
      // No se migran automáticamente desde customFields/address; se piden
      // al editar la ficha o al emitir la primera factura para el cliente.
      fiscalName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalCity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalZip: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      fiscalCountry: {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: "ES",
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "prospect"),
        allowNull: false,
        defaultValue: "active",
      },
      portalAccess: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      portalEmail: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Tutores separados (Aumenta): relevante para el caso de varios pagadores
      // por paciente (padres separados). Nullable: no aplica a la mayoría de
      // clientes (empresas, cliente individual sin pacientes…).
      separated: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null,
      },
      // ── Sprint Aumenta 2026-07-28 ───────────────────────────────────────
      // Padres/tutores estructurados: [{ id, name, relationship, dni, phone,
      // email, signer }] (lib/clients/guardians.js). Ambos progenitores viven
      // SIEMPRE en el mismo cliente, también separados; las firmas del
      // contrato apuntan al `id` de cada tutor.
      guardians: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Meses ('YYYY-MM') desbloqueados A MANO por administración en el
      // portal aunque no conste el cobro (becas, acuerdos, errores). El
      // desbloqueo normal es automático al registrar el cobro del mes.
      portalUnlockedMonths: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Contrato del Centro subido al inscribir al cliente (FK lógica a
      // documents; el flujo de firma vive en ContractSignature).
      contractDocumentId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "clients",
    }
  );
}
