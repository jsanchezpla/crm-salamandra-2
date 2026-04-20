const { Sequelize, Op } = await import("sequelize");

const db = new Sequelize("postgresql://postgres:portero_1@localhost:5432/salamandra", {
  logging: false,
});

// Elimina leads sin email ni teléfono que solo tienen nombre (basura del import)
const [, meta] = await db.query(`
  DELETE FROM crm_quality_energy.leads
  WHERE email IS NULL
    AND phone IS NULL
    AND source = 'csv_import';
`);

console.log(`Eliminados: ${meta.rowCount} leads`);
await db.close();
