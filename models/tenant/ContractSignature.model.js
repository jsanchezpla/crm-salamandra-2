import { DataTypes } from "sequelize";

/**
 * ContractSignature — firma web del Contrato del Centro (sprint Aumenta
 * 2026-07-28). Firma electrónica SIMPLE: el progenitor/tutor dibuja su firma
 * en pantalla y se guarda la imagen + fecha + IP + user-agent como traza.
 *
 * `guardianId` apunta a la entrada correspondiente de `Client.guardians`
 * (JSONB): cada tutor firma UNA vez (UNIQUE client+guardian). Con padres
 * separados (`Client.separated`) se exigen las firmas de TODOS los tutores
 * marcados como firmantes antes de abrir la documentación del portal.
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
      // Foto del nombre en el momento de firmar (guardians es editable).
      signerName: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      // Ruta en disco de la imagen PNG de la firma dibujada.
      signaturePath: {
        type: DataTypes.STRING(500),
        allowNull: false,
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
        { fields: ["client_id", "guardian_id"], unique: true, name: "contract_signatures_unique" },
      ],
    }
  );
}
