/**
 * migrate-outreach-lead-status.js
 *
 * Añade a `outreach_leads` el seguimiento manual del comercial:
 *
 *   status     VARCHAR(32) NOT NULL DEFAULT 'new'   new | contacted | discarded
 *   status_at  TIMESTAMPTZ                          cuándo se puso ese estado
 *
 * Hasta ahora lo único que se podía marcar en un lead era convertirlo en
 * cliente: no había forma de decir «a este ya le escribí» ni «a este lo
 * descarto». Ver lib/outreach/estados.js.
 *
 * Backfill: los leads que ya tienen un correo enviado (`outreach_analyses.sent_at`)
 * pasan a 'contacted' con la fecha de ese envío, que es la verdad de lo ocurrido.
 * El resto se quedan en 'new' por el DEFAULT.
 *
 * - Selección por EXISTENCIA de tabla (`byTable`), no por módulo activo:
 *   ver scripts/_schema-targets.js.
 * - Idempotente: ADD COLUMN IF NOT EXISTS + índice con guarda; el backfill solo
 *   toca filas que sigan en 'new', así que repetirlo no pisa cambios manuales.
 * - Por schema independiente: si uno falla, sigue con el resto.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-lead-status.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-lead-status.js
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

async function indexExists(s, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "outreach_leads"))) {
    return { skipped: true };
  }

  await s.query(`
    ALTER TABLE "${schema}"."outreach_leads"
      ADD COLUMN IF NOT EXISTS status    VARCHAR(32) NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ
  `);

  if (!(await indexExists(s, schema, "outreach_leads_status_idx"))) {
    await s.query(`CREATE INDEX outreach_leads_status_idx ON "${schema}"."outreach_leads" (status)`);
  }

  // Backfill: si ya se le envió un correo desde el CRM, está contactado.
  let backfilled = 0;
  if (await tableExists(s, schema, "outreach_analyses")) {
    const [, meta] = await s.query(`
      UPDATE "${schema}"."outreach_leads" l
         SET status = 'contacted',
             status_at = envios.primer_envio
        FROM (
          SELECT outreach_lead_id, MIN(sent_at) AS primer_envio
            FROM "${schema}"."outreach_analyses"
           WHERE sent_at IS NOT NULL
           GROUP BY outreach_lead_id
        ) AS envios
       WHERE envios.outreach_lead_id = l.id
         AND l.status = 'new'
    `);
    backfilled = meta?.rowCount ?? 0;
  }

  return { skipped: false, backfilled };
}

async function main() {
  process.stdout.write("\n═══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Captación — estado del lead             \n");
  process.stdout.write("═══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "outreach_leads");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla outreach_leads.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla outreach_leads, se omiten: ${skipped.join(", ")}`);

  for (const schema of schemas) {
    try {
      const r = await processSchema(sequelize, schema);
      if (r.skipped) log(`· ${schema}: sin outreach_leads (se salta)`);
      else log(`· ${schema}: columnas OK${r.backfilled ? ` · ${r.backfilled} ya contactados` : ""}`);
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
