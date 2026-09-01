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
      //
      // ⚠️ `taxId` (arriba) y `fiscalTaxId` (abajo) NO son lo mismo, aunque
      // coincidan casi siempre. `taxId` es el documento de la PERSONA de la
      // ficha —el que sale en el contrato que firma en el área privada—;
      // `fiscalTaxId` es a nombre de quién se emite la FACTURA, que puede ser
      // el otro progenitor o una empresa con CIF. Todo el módulo de facturación
      // los resuelve con `nifDeCliente()` (lib/billing/nifCliente.js), nunca
      // leyendo la columna a pelo.
      fiscalName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fiscalTaxId: {
        type: DataTypes.STRING(50),
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
       * La cuota del mes de esta familia: los ids de los conceptos del
       * catálogo que la componen (31/08/2026, Rodrigo — «al pulsar el cliente
       * debería rellenarse su cuota»). La rellena el volcado del Organízate y
       * la RE-APRENDE cada cobro de cuota: lo último que se le cobró es su
       * cuota. Vacío o null = sin cuota conocida, el drawer no rellena nada.
       */
      cuotaConceptIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "cuota_concept_ids",
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
      /**
       * Su profesional: con quién lleva el seguimiento (06/08/2026, Rodrigo).
       *
       * Se decide al ACEPTAR su solicitud en la bandeja, que es el momento en
       * que alguien mira el caso y dice «esta va contigo». A partir de ahí, la
       * agenda pública le enseña SOLO los huecos de esa persona: en un centro
       * con equipo, ver los de otra es ofrecerle una cita que no le toca.
       *
       * `null` = sin asignar, y entonces ve la agenda de siempre. Es el estado
       * de todo lo anterior a esto y el de cualquier consulta de una sola
       * profesional: nadie tiene que asignar nada para que siga funcionando.
       */
      /**
       * «Consulta externa» (07/08/2026, Rodrigo): paciente que se atiende por
       * un acuerdo con una empresa, no por la consulta.
       *
       * Su historia clínica y sus documentos se guardan aquí como los de
       * cualquiera —Laura no quiere dos archivos— pero NO lleva cuenta en la
       * web: ni portal, ni documentos compartidos, ni contratos que firmar.
       *
       * Solo lo ven admin y la profesional que lo tenga asignado
       * (`lib/clients/consultaExterna.js`).
       *
       * `false` por defecto y NOT NULL: el listado filtra por «no es externa»,
       * y dejarlo a NULL haría desaparecer del CRM todas las fichas que ya
       * existen hasta que alguien las guardara una a una.
       */
      esConsultaExterna: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /**
       * La empresa con la que hay acuerdo. Texto libre a propósito: la lista de
       * empresas vive en los ajustes del tenant y se edita en Configuración, y
       * quitar una de esa lista no debe dejar huérfanos a sus pacientes.
       */
      categoriaExterna: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      assignedTeamMemberId: {
        type: DataTypes.UUID,
        allowNull: true,
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
