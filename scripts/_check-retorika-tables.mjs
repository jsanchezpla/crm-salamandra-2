import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const db = await getTenantDb("retorika");

// 1. ¿Existe el schema?
const schemaQ = await db.sequelize.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'crm_retorika'"
);
console.log("Resultado schema query:", JSON.stringify(schemaQ, null, 2));

// 2. Listar TODOS los schemas crm_* que existen
const allSchemas = await db.sequelize.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name"
);
console.log("Schemas crm_* existentes:", JSON.stringify(allSchemas, null, 2));

await closeAllConnections();
