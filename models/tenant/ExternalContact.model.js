import { DataTypes } from "sequelize";

/**
 * ExternalContact — agenda de profesionales EXTERNOS de un paciente.
 *
 * La orientadora del instituto, la tutora del cole, el psiquiatra, la PT del
 * aula TEA… gente de fuera del centro con la que se coordina el caso.
 *
 * POR QUÉ EXISTE (Rodrigo, 02/08/2026): hasta ahora una `Coordination` guardaba
 * a los participantes como TEXTO LIBRE (`participants`) y la entidad como otra
 * cadena (`externalEntity`). Eso significa que el nombre de la misma orientadora
 * se reescribe en cada acta, no se puede saber que es la misma persona, y su
 * teléfono no vive en ningún sitio: hay que buscarlo en el acta anterior. Al
 * migrar Aumenta aparecieron estos contactos metidos a mano en las ranuras de
 * «tutor» de Organízate, que es justo el síntoma de que faltaba este sitio.
 *
 * ── Qué NO es ──────────────────────────────────────────────────────────────
 *
 * · No es `Contact`: aquel cuelga de un CLIENTE y lo usa el módulo de tickets
 *   (contactos comerciales). Mezclarlos pondría al comercial de un proveedor
 *   junto a la logopeda del colegio de un menor.
 * · No es un tutor (`Client.guardians`): un tutor es familia y firma el
 *   contrato del centro. Estos no firman nada ni tienen potestad sobre el
 *   paciente.
 *
 * `role` es texto libre a propósito: «Psicóloga del cole», «Orientadora
 * instituto», «PT del aula TEA»… Una lista cerrada se quedaría corta el primer
 * día, y ya sabemos cómo acaba eso — la gente escribiendo en el hueco que
 * encuentre, que es de donde venimos.
 */
export function defineExternalContact(sequelize) {
  return sequelize.define(
    "ExternalContact",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // La agenda es DEL PACIENTE: la orientadora lo es de ese niño concreto.
      patientId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Familia del paciente. Se rellena al crear (foto, como el resto de
      // enlaces clínicos) para poder listar los contactos de una familia sin
      // pasar por el paciente. Nullable: hay pacientes sin cliente asociado.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Lo único obligatorio. Un contacto sin nombre no sirve para nada.
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      // Texto libre: «Psicóloga del cole», «Orientadora instituto», «PT»…
      role: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      // Centro al que pertenece («CEIP San José», «Hospital Niño Jesús»).
      entity: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "external_contacts",
      indexes: [
        { fields: ["patient_id"], name: "external_contacts_patient_idx" },
        { fields: ["client_id"], name: "external_contacts_client_idx" },
      ],
    }
  );
}
