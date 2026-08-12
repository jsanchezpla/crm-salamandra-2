import { createSequelizeInstance } from "./sequalize.js";
import { defineTenant } from "../../models/master/Tenant.model.js";
import { defineUser } from "../../models/master/User.model.js";
import { defineTenantModule } from "../../models/master/TenantModule.model.js";
import { defineAuditLog } from "../../models/master/AuditLog.model.js";
import { defineTableroEstado } from "../../models/master/TableroEstado.model.js";
import { definePaqueteModulos } from "../../models/master/PaqueteModulos.model.js";

let instance = null;
let models = null;

function initMasterDb() {
  const sequelize = createSequelizeInstance("master");

  const Tenant = defineTenant(sequelize);
  const User = defineUser(sequelize);
  const TenantModule = defineTenantModule(sequelize);
  const AuditLog = defineAuditLog(sequelize);
  // Estado del Registro (tick y reparto). No tiene asociaciones: cuelga de una
  // tarea de `docs/backlog.md`, que no es una fila de nadie.
  const TableroEstado = defineTableroEstado(sequelize);
  // Paquetes de módulos: lo que se vende con un nombre. TAMPOCO tiene
  // asociaciones, y en este caso es la decisión de producto entera: ningún
  // cliente «tiene» un paquete, solo módulos sueltos. Ver el modelo.
  const PaqueteModulos = definePaqueteModulos(sequelize);

  // Associations
  Tenant.hasMany(User, { foreignKey: "tenantId", as: "users" });
  User.belongsTo(Tenant, { foreignKey: "tenantId", as: "tenant" });

  Tenant.hasMany(TenantModule, { foreignKey: "tenantId", as: "modules" });
  TenantModule.belongsTo(Tenant, { foreignKey: "tenantId", as: "tenant" });

  Tenant.hasMany(AuditLog, { foreignKey: "tenantId", as: "auditLogs" });
  User.hasMany(AuditLog, { foreignKey: "userId", as: "auditLogs" });

  return { sequelize, Tenant, User, TenantModule, AuditLog, TableroEstado, PaqueteModulos };
}

export function getMasterDb() {
  if (!instance) {
    const { sequelize, ...rest } = initMasterDb();
    instance = sequelize;
    models = rest;
  }
  return instance;
}

export function getMasterModels() {
  if (!models) {
    getMasterDb();
  }
  return models;
}
