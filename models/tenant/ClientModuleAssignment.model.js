import { DataTypes } from "sequelize";

/**
 * ClientModuleAssignment — asigna un Client a un módulo funcional del CRM
 * (nutricion, clinica, …) para que aparezca en ese módulo.
 *
 * Diseño (Opción B del sprint "Clientes ↔ módulos"): tabla intermedia por
 * `module_key` en lugar de columnas boolean en `clients`. Ventajas:
 *   - Extensible a N módulos sin nueva migración (solo un module_key nuevo).
 *   - Metadata por asignación (p.ej. nutricionista asignado) en `metadata` JSONB.
 *   - Histórico (`assigned_at`, `assigned_by_user_id`, timestamps) y baja lógica
 *     (`enabled`) sin perder la traza.
 *   - No contamina el modelo `Client` compartido por todos los tenants.
 *
 * `UNIQUE(client_id, module_key)`: un cliente tiene como mucho una fila por
 * módulo (se hace upsert sobre esa pareja).
 *
 * Nota: la mitad de Nutrición es "intención/pertenencia"; la vista
 * `/nutricion/asignados` sigue siendo plan-céntrica hasta el refactor del
 * siguiente sprint. La mitad de Clínica sí materializa un `Patient` enlazado
 * (ver lib/clients/moduleAssignments.js).
 */
export function defineClientModuleAssignment(sequelize) {
  return sequelize.define(
    "ClientModuleAssignment",
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
      moduleKey: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Usuario (master.users.id) que marcó la asignación. Sin FK física: vive
      // en otro schema (master), igual que el patrón de audit del CRM.
      assignedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "client_module_assignments",
      indexes: [
        { unique: true, fields: ["client_id", "module_key"], name: "cma_client_module_unique" },
        { fields: ["module_key", "enabled"], name: "cma_module_enabled_idx" },
      ],
    }
  );
}
