import { Sequelize } from "sequelize";
const db = new Sequelize(process.env.DATABASE_URL, { logging: false });
const [rows] = await db.query(
  "SELECT id, name, stage FROM crm_quality_energy.leads WHERE id = 'c492f0f4-6aab-4a4d-bf0b-099b5c97a4ee'"
);
console.log(rows);
await db.close();
