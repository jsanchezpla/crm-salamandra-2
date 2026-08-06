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
      /**
       * Fecha de nacimiento (04/08/2026). No existía: la tenía `Patient`, y en
       * un centro de nutrición el paciente ES el cliente, así que no había
       * dónde guardarla.
       *
       * DATEONLY y no DATE a propósito: una fecha de nacimiento no tiene hora,
       * y con zona horaria de por medio un 1 de enero se convierte en 31 de
       * diciembre en cuanto el servidor no está en Madrid.
       *
       * Es además lo que decide si una paciente necesita el consentimiento de
       * su tutor legal, así que se pide en la ficha y no solo al firmar.
       */
      birthDate: {
        type: DataTypes.DATEONLY,
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
      /**
       * Sus citas del portal entran YA CONFIRMADAS, sin pasar por la bandeja
       * (06/08/2026, Rodrigo).
       *
       * El centro puede pedir que toda reserva pública espere su visto bueno
       * (`autoConfirmPublicBookings` del módulo citas). Eso está bien para quien
       * llega de nuevas, y sobra para la paciente de siempre que viene los
       * martes a la misma hora: confirmarle a mano cada cita es trabajo que no
       * decide nada. Este interruptor la exime, una a una y a criterio de la
       * profesional.
       *
       * Apagado por defecto: exime, nunca al revés. Encenderlo no salta ninguna
       * otra puerta —formulario, contrato, identidad— ni el cobro: una cita con
       * precio sigue naciendo pendiente hasta que se retiene la tarjeta.
       */
      autoConfirmBookings: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Consentimiento de COMUNICACIONES de la familia (01/08/2026): por qué
      // canales quiere que se le escriba y si acepta novedades del centro, con
      // la traza de cuándo y desde dónde lo dijo (lib/clients/comunicaciones.js).
      // Va en el cliente y no en el paciente porque quien recibe los mensajes es
      // la familia; lo del niño (imágenes) sigue en `patients.consents`.
      communicationPrefs: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
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
