/**
 * migrate-outreach-email-template.js
 *
 * Añade a `outreach_settings` la plantilla del correo en frío del tenant:
 *
 *   email_template  TEXT  estructura, tono y reglas con las que la IA redacta
 *
 * Hasta ahora las instrucciones de redacción del correo estaban a fuego en
 * `lib/outreach/analysis/prompt.js` («4-6 frases, firma del equipo»), iguales
 * para todos los tenants. Con la columna vacía el prompt se comporta igual que
 * siempre, así que esta migración no cambia el correo de nadie: solo abre la
 * puerta a que un tenant escriba el suyo desde Configuración → Captación.
 *
 * - Selección por EXISTENCIA de tabla (`byTable`), no por módulo activo:
 *   ver scripts/_schema-targets.js.
 * - Idempotente: ADD COLUMN IF NOT EXISTS.
 * - Por schema independiente: si uno falla, sigue con el resto.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-email-template.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-email-template.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "outreach_settings"))) {
    return { skipped: true };
  }
  await s.query(`
    ALTER TABLE "${schema}"."outreach_settings"
      ADD COLUMN IF NOT EXISTS email_template TEXT
  `);
  return { skipped: false };
}

async function main() {
  process.stdout.write("\n═════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Outreach — plantilla del correo       \n");
  process.stdout.write("═════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "outreach_settings");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla outreach_settings.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla outreach_settings, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      const r = await processSchema(sequelize, schema);
      log(r.skipped ? `· ${schema}: sin outreach_settings (se salta)` : `· ${schema}: columna OK`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
