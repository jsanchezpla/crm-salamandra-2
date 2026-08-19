import { createSequelizeInstance } from "./sequalize.js";
import { defineTenant } from "../../models/master/Tenant.model.js";
import { defineUser } from "../../models/master/User.model.js";
import { defineTenantModule } from "../../models/master/TenantModule.model.js";
import { defineAuditLog } from "../../models/master/AuditLog.model.js";
import { defineTableroEstado } from "../../models/master/TableroEstado.model.js";
import { defineTableroDocumento } from "../../models/master/TableroDocumento.model.js";
import { definePaqueteModulos } from "../../models/master/PaqueteModulos.model.js";
import { defineBuzonAviso } from "../../models/master/BuzonAviso.model.js";
import { defineBuzonMensaje } from "../../models/master/BuzonMensaje.model.js";
import { defineBuzonAdjunto } from "../../models/master/BuzonAdjunto.model.js";

let instance = null;
let models = null;

function initMasterDb() {
  const sequelize = createSequelizeInstance("master");

  const Tenant = defineTenant(sequelize);
  const User = defineUser(sequelize);
  const TenantModule = defineTenantModule(sequelize);
  const AuditLog = defineAuditLog(sequelize);
  // El Registro: el TEXTO (backlog y resuelto, una fila por versión, desde el
  // 19/08/2026) y el estado que se le pone encima (tick y reparto). Sin
  // asociaciones entre ellos a propósito: el estado casa por título normalizado,
  // no por fila, para que reescribir el texto no arrastre claves.
  const TableroDocumento = defineTableroDocumento(sequelize);
  const TableroEstado = defineTableroEstado(sequelize);
  // Paquetes de módulos: lo que se vende con un nombre. TAMPOCO tiene
  // asociaciones, y en este caso es la decisión de producto entera: ningún
  // cliente «tiene» un paquete, solo módulos sueltos. Ver el modelo.
  const PaqueteModulos = definePaqueteModulos(sequelize);
  // Buzón: lo que un cliente nos escribe A NOSOTROS. Va en master, y no en el
  // schema de quien escribe, para que sobreviva a su baja y para que funcione
  // aunque su base esté rota — que es justo cuando escriben. El razonamiento
  // largo, y por qué es una excepción a la regla de no duplicar datos
  // personales en master, está en `models/master/BuzonAviso.model.js`.
  const BuzonAviso = defineBuzonAviso(sequelize);
  const BuzonMensaje = defineBuzonMensaje(sequelize);
  const BuzonAdjunto = defineBuzonAdjunto(sequelize);

  // Associations
  Tenant.hasMany(User, { foreignKey: "tenantId", as: "users" });
  User.belongsTo(Tenant, { foreignKey: "tenantId", as: "tenant" });

  Tenant.hasMany(TenantModule, { foreignKey: "tenantId", as: "modules" });
  TenantModule.belongsTo(Tenant, { foreignKey: "tenantId", as: "tenant" });

  Tenant.hasMany(AuditLog, { foreignKey: "tenantId", as: "auditLogs" });
  User.hasMany(AuditLog, { foreignKey: "userId", as: "auditLogs" });

  // El aviso con su hilo y sus capturas. NO se asocia a Tenant ni a User a
  // propósito: `tenantId`/`usuarioId` son UUID sueltos, sin FK, para que dar de
  // baja a un cliente no se lleve por delante lo que escribió (ver el modelo).
  BuzonAviso.hasMany(BuzonMensaje, { foreignKey: "avisoId", as: "mensajes" });
  BuzonMensaje.belongsTo(BuzonAviso, { foreignKey: "avisoId", as: "aviso" });
  BuzonAviso.hasMany(BuzonAdjunto, { foreignKey: "avisoId", as: "adjuntos" });
  BuzonAdjunto.belongsTo(BuzonAviso, { foreignKey: "avisoId", as: "aviso" });

  return {
    sequelize,
    Tenant,
    User,
    TenantModule,
    AuditLog,
    TableroDocumento,
    TableroEstado,
    PaqueteModulos,
    BuzonAviso,
    BuzonMensaje,
    BuzonAdjunto,
  };
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
