import { DataTypes } from "sequelize";

/**
 * ContractSignature — firma web del Contrato del Centro (sprint Aumenta
 * 2026-07-28). Firma electrónica SIMPLE: el progenitor/tutor dibuja su firma
 * en pantalla y se guarda la imagen + fecha + IP + user-agent como traza.
 *
 * `guardianId` apunta a la entrada correspondiente de `Client.guardians`
 * (JSONB): cada tutor firma UNA vez POR DOCUMENTO (UNIQUE client+guardian+
 * template). Con padres separados (`Client.separated`) se exigen las firmas de
 * TODOS los tutores marcados como firmantes antes de abrir la documentación
 * del portal.
 *
 * Ampliado el 2026-08-04 (sprint tunutrilaura) para que la firma deje de ser
 * solo un garabato: guarda también los DATOS que declaró quien firma y QUÉ
 * documentos aceptó, uno por uno. El contrato de Laura tiene tres anexos que
 * «se firman de forma independiente al documento principal», así que una sola
 * casilla para todo el paquete no vale como aceptación de ninguno.
 */
export function defineContractSignature(sequelize) {
  return sequelize.define(
    "ContractSignature",
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
      guardianId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /**
       * QUÉ documento se firmó: la `key` de ContractTemplate ('paciente',
       * 'parental'…). 'simple' es el contrato de antes del 04/08/2026, el del
       * PDF suelto sin datos ni anexos, que sigue siendo lo que usa Aumenta.
       *
       * Es texto y no una FK: la firma es la PRUEBA de lo que alguien aceptó y
       * tiene que sobrevivir a que la plantilla se borre o se rehaga.
       */
      templateKey: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "simple",
      },
      // Versión de la plantilla en el momento de firmar. Cambiar una cláusula
      // sube la versión; sin esto, el clausulado nuevo se leería como si lo
      // hubiera aceptado quien firmó el viejo.
      templateVersion: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Foto del nombre en el momento de firmar (guardians es editable).
      signerName: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      /**
       * Foto de TODO lo que declaró: DNI, domicilio, teléfono, fecha de
       * nacimiento, localidad de la firma… `{ key: valor }` según los `fields`
       * de la plantilla.
       *
       * Se guarda aquí y NO se vuelca sobre la ficha del cliente: la ficha la
       * mantiene el centro y puede corregirla; esto es lo que la persona dijo
       * el día que firmó, y tiene que quedarse como estaba.
       */
      signerData: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      /**
       * Aceptación documento a documento: `[{ id, title, acceptedAt }]`. Los
       * anexos del contrato se firman de forma independiente y hay que poder
       * demostrar cada uno por separado — sobre todo el Anexo I, que es el que
       * renuncia a la devolución del importe.
       */
      acceptances: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      // Ruta en disco de la imagen PNG de la firma dibujada.
      signaturePath: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      /**
       * Segunda firma opcional del mismo documento: el asentimiento de la
       * persona menor en el consentimiento parental. NULL en todo lo demás.
       */
      secondSignaturePath: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      /**
       * PDF generado con los datos, el clausulado y la firma dentro — la copia
       * de la persona que firma. Fila de `documents`; nullable porque la firma
       * ya es válida sin él y no se puede perder por un fallo al escribir un
       * fichero.
       */
      documentId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "contract_signatures",
      indexes: [
        // Una firma por persona y DOCUMENTO. El índice viejo era
        // (client_id, guardian_id) y con dos documentos —contrato y
        // consentimiento parental— el segundo chocaba con el primero: el mismo
        // tutor tiene que poder firmar los dos.
        {
          fields: ["client_id", "guardian_id", "template_key"],
          unique: true,
          name: "contract_signatures_unique",
        },
      ],
    }
  );
}
