import { DataTypes } from "sequelize";

export function defineInvoice(sequelize) {
  return sequelize.define(
    "Invoice",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // ── Campos legacy del dominio terapéutico (NO usar en código nuevo) ──
      // No se borran porque el modelo billing antiguo aún los referencia.
      // Sprint futuro: limpieza de familyId/serviceType/invoiceType.
      familyId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Paciente al que corresponde la factura (Fase 2a facturación de pacientes).
      // El pagador es Invoice.clientId; patientId es solo la trazabilidad interna
      // "esta factura es de este paciente" (una fundación/tía/abuelo puede pagar
      // por él). Columna reutilizada (antes durmiente); el enlace va en columna, NO
      // en customFields, porque la rectificativa reinicia customFields a {}.
      patientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      /*
       * A NOMBRE DE QUÉ TUTOR va la factura (02/09/2026, decisión de Rodrigo).
       *
       * El pagador sigue siendo `clientId` (la familia): la factura cuelga de
       * su ficha, de sus cobros y de su morosidad. Esto dice a QUIÉN se le
       * emite cuando no es la ficha entera sino uno de sus tutores —padres
       * separados, cada uno con su parte—: el `id` de la entrada de
       * `clients.guardians`. Al emitir se congela su nombre y su DNI en
       * `fiscalSnapshot` (lib/billing/datosFiscales.js). Sin FK: el tutor vive
       * en un JSONB. Columna propia y no customFields, por lo mismo que
       * patientId: la rectificativa reinicia customFields a {}.
       */
      guardianId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      serviceType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      /*
       * QUÉ TIPO DE CITA SE COBRÓ CON ESTA FACTURA (29/08/2026, Rodrigo).
       *
       * El dinero por servicio no se sabe por el precio del tipo de cita
       * (valor de agenda): solo se sabe por lo FACTURADO. Este enlace es la
       * pieza que lo permite — «Ingresos por servicio» de la portada agrupa
       * facturas del mes por esta columna. Interno y opcional: una factura sin
       * tipo simplemente no cuenta en esa gráfica. Columna propia y NO
       * customFields, por lo mismo que patientId: la rectificativa reinicia
       * customFields a {}.
       */
      eventTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      invoiceType: {
        type: DataTypes.ENUM("session", "pack", "subscription"),
        allowNull: true,
      },
      // ── Identificación ──────────────────────────────────────────────────
      employeeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Socio que "gana" esta factura. Mientras no seamos SL, cada socio
      // (Jorge / Rodrigo) factura por separado. id de settings.partners.
      partnerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // FK durmiente a Project (Sprint 1 Proyectos). Sin uso desde la UI ni
      // desde la lógica de cálculo de rentabilidad; se activa en Sprint 4
      // del ciclo Proyectos.
      projectId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      series: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "F",
      },
      number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // ── Estado y fechas ─────────────────────────────────────────────────
      status: {
        type: DataTypes.ENUM(
          "draft",
          "issued",
          "sent",
          "paid",
          "partially_paid",
          "overdue",
          "cancelled",
          "rectified"
        ),
        allowNull: false,
        defaultValue: "draft",
      },
      issueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // ── Líneas (estructura nueva con IVA por línea) ─────────────────────
      // Cada línea: { description, quantity, unitPrice, discountPct, vatRate,
      //               lineBase, lineVat, lineTotal }
      lines: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      // ── Totales calculados ──────────────────────────────────────────────
      taxBase: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // ── Retención IRPF ──────────────────────────────────────────────────
      // Se aplica sobre la BASE IMPONIBLE: total = base + IVA − IRPF.
      // Típico para autónomos/profesionales: 15% (7% primeros años).
      irpfRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },
      irpfAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Cache de la suma de cobros completed asociados
      paidAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // ── Compatibilidad con cálculo antiguo (no se usa en código nuevo) ──
      // subtotal y vatRate quedaban como una sola tasa por factura.
      // Mantenidos para no romper datos antiguos durante un tiempo.
      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vatRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },
      discountType: {
        type: DataTypes.ENUM("percent", "fixed"),
        allowNull: true,
      },
      discountValue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      // ── Rectificativas ──────────────────────────────────────────────────
      rectifiesInvoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      rectifiedByInvoiceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Motivo de la rectificación (dropdown en la UI: error de importe,
      // error de IVA, error de datos, otros). Solo lo llevan las facturas
      // de serie R (rectificativas). Nullable para el resto.
      correctionReason: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // ── Otros ───────────────────────────────────────────────────────────
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      pdfUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      recurringConfig: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // ── Verifactu / Facturantia (no se toca en este sprint) ─────────────
      facturantiaId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      qrUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      verifactuStatus: {
        type: DataTypes.ENUM("pending", "sent", "accepted", "rejected"),
        allowNull: true,
      },
      verifactuSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      /*
       * A QUIÉN SE LE EMITIÓ, CONGELADO EL DÍA QUE SE EMITIÓ (26/08/2026).
       *
       * { nombre, nif, direccion, cp, ciudad, pais }. Hasta hoy la factura no
       * guardaba ni un dato fiscal propio y todo se leía de la ficha del cliente
       * al generar el documento: corregir un NIF cambiaba hacia atrás y en
       * silencio todas las facturas ya emitidas de esa persona.
       *
       * NULLABLE a propósito, y las viejas se quedan sin foto: rellenarlas con
       * los datos de hoy estamparía como «lo que decía la factura de 2022» algo
       * que quizá se corrigió después. Sin foto se lee del cliente, como hasta
       * hoy — lo decide `lib/billing/datosFiscales.js`.
       *
       * Columna propia y NO `customFields`: la rectificativa reinicia
       * `customFields` a {} y se llevaría la foto por delante.
       */
      fiscalSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "invoices",
    }
  );
}
