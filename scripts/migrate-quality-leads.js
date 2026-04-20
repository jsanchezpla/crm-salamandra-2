const { Sequelize } = await import("sequelize");

const db = new Sequelize("postgresql://postgres:portero_1@localhost:5432/salamandra");

await db.query(`
  ALTER TABLE crm_quality_energy.leads
    ADD COLUMN IF NOT EXISTS source VARCHAR(255),
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
`);

console.log("OK — columnas añadidas");
await db.close();
