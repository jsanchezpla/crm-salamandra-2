/**
 * migrate-quality-leads.js
 *
 * Histórico — añade columnas `source` y `metadata` a `crm_quality_energy.leads`.
 * Antes esos campos no existían en el modelo y se introdujeron a posteriori.
 * Hoy ya están en la definición de Sequelize, por lo que un seed nuevo crearía
 * la columna desde cero. Este script solo es relevante si se reactiva una BD
 * antigua de quality_energy que aún no las tenga.
 *
 * Lee la conexión de DATABASE_URL del entorno (no hardcodear credenciales).
 *
 * Uso local:    node --env-file=.env.local scripts/migrate-quality-leads.js
 * Uso prod:     docker compose exec app node --env-file=.env.production scripts/migrate-quality-leads.js
 */
import { Sequelize } from "sequelize";

if (!process.env.DATABASE_URL) {
  process.stderr.write("✗ Falta DATABASE_URL. Usa --env-file=.env.local o .env.production.\n");
  process.exit(1);
}

const db = new Sequelize(process.env.DATABASE_URL, { logging: false });

await db.query(`
  ALTER TABLE crm_quality_energy.leads
    ADD COLUMN IF NOT EXISTS source VARCHAR(255),
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
`);

console.log("OK — columnas añadidas");
await db.close();
