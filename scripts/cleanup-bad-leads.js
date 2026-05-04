/**
 * cleanup-bad-leads.js
 *
 * Borra leads de `crm_quality_energy` con email/phone NULL y source = 'csv_import'
 * (basura del primer import masivo). Histórico, ejecutado en su día tras la
 * migración inicial; conservado por si hace falta repetirlo en algún reseed.
 *
 * Lee la conexión de DATABASE_URL del entorno (no hardcodear credenciales).
 *
 * Uso local:    node --env-file=.env.local scripts/cleanup-bad-leads.js
 * Uso prod:     docker compose exec app node --env-file=.env.production scripts/cleanup-bad-leads.js
 */
import { Sequelize } from "sequelize";

if (!process.env.DATABASE_URL) {
  process.stderr.write("✗ Falta DATABASE_URL. Usa --env-file=.env.local o .env.production.\n");
  process.exit(1);
}

const db = new Sequelize(process.env.DATABASE_URL, { logging: false });

const [, meta] = await db.query(`
  DELETE FROM crm_quality_energy.leads
  WHERE email IS NULL
    AND phone IS NULL
    AND source = 'csv_import';
`);

console.log(`Eliminados: ${meta.rowCount} leads`);
await db.close();
