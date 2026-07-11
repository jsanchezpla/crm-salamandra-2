import { Sequelize } from "sequelize";
const url = process.env.DATABASE_URL;
console.log("DATABASE_URL:", url ? url.replace(/:[^:@/]+@/, ":***@") : "(vacío)");
const sequelize = new Sequelize(url, { logging: false });
const [db] = await sequelize.query("SELECT current_database() AS db, current_user AS usr");
console.log("Conectado a:", db[0]);
const [schemas] = await sequelize.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' OR schema_name='master' ORDER BY schema_name"
);
console.log("Schemas:", schemas.map((s) => s.schema_name).join(", ") || "(ninguno)");
await sequelize.close();
