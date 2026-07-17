import { DataTypes } from "sequelize";

/**
 * ClientContactMethod — emails y teléfonos MÚLTIPLES de un cliente, etiquetados.
 *
 * Aumenta (centro de psicopedagogía) necesita registrar varios contactos por
 * cliente/tutor (madre, padre, trabajo…), con uno marcado como PRINCIPAL. El
 * principal se refleja (mirror) en `Client.email` / `Client.phone`, que siguen
 * siendo la fuente para facturación, avisos de cita y acceso al portal "Mis
 * citas" — así el resto del CRM sigue funcionando sin cambios y solo el
 * principal da acceso al portal (decisión de Aumenta).
 *
 * No se confunde con `Contact` (contactos por rol de una empresa cliente): esto
 * son métodos de contacto (email/teléfono) de una MISMA persona.
 *
 * La sincronización del mirror (poner Client.email = método email principal) la
 * hace el endpoint de contactos, no el modelo.
 */
export function defineClientContactMethod(sequelize) {
  return sequelize.define(
    "ClientContactMethod",
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
      kind: {
        type: DataTypes.ENUM("email", "phone"),
        allowNull: false,
      },
      // 255 = igual que Client.email/phone (columna espejo): así no falla antes
      // ni de forma distinta a como ya lo hacía el CRM con un valor muy largo.
      value: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Etiqueta libre: "Madre", "Padre", "Trabajo"… (Aumenta pidió etiquetar).
      label: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      // Uno principal por tipo (email/teléfono). El endpoint lo garantiza y
      // refleja el valor en Client.email / Client.phone.
      isPrimary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "client_contact_methods",
      indexes: [
        { fields: ["client_id"], name: "client_contact_methods_client_idx" },
        // Como mucho un principal por (cliente, tipo).
        {
          fields: ["client_id", "kind"],
          name: "client_contact_methods_primary_uq",
          unique: true,
          where: { is_primary: true },
        },
      ],
    }
  );
}
