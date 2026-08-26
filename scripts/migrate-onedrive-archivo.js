/**
 * migrate-onedrive-archivo.js — dos columnas para la migración del archivo de
 * OneDrive (26/08/2026, Rodrigo: los informes en la ficha del paciente,
 * navegables por años y meses; las fotos y vídeos se quedan en OneDrive con
 * un botón por paciente).
 *
 *   - documents.document_date DATE NULL — la fecha DEL DOCUMENTO (el informe
 *     de junio de 2024 es de junio de 2024), distinta de created_at, que es
 *     cuándo entró al CRM. Sin ella, importar 6.900 ficheros hoy los apilaría
 *     todos en «agosto 2026» y la cronología no diría nada.
 *     Backfill: created_at::date en las filas que ya existan (para lo subido a
 *     mano, la fecha de subida ES su mejor fecha conocida).
 *   - patients.external_links JSONB [] — enlaces externos de la ficha
 *     ([{label, url}]); el primero de la casa: la carpeta de OneDrive del
 *     paciente con sus fotos y vídeos.
 *
 * Selecciona schemas por EXISTENCIA de tabla (documents / patients).
 * Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-onedrive-archivo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-onedrive-archivo.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: fecha del documento + enlaces externos del paciente\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas: conDocs } = await byTable(s, "documents");
  for (const schema of conDocs) {
    await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS document_date DATE`);
    const [, meta] = await s.query(
      `UPDATE "${schema}"."documents" SET document_date = created_at::date WHERE document_date IS NULL`
    );
    log(`✓ ${schema}.documents.document_date (backfill ${meta?.rowCount ?? 0})`);
  }
  if (conDocs.length === 0) log("· Ningún schema con tabla documents.");

  const { schemas: conPac } = await byTable(s, "patients");
  for (const schema of conPac) {
    await s.query(`ALTER TABLE "${schema}"."patients" ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
    log(`✓ ${schema}.patients.external_links`);
  }
  if (conPac.length === 0) log("· Ningún schema con tabla patients.");

  process.stdout.write("\n✓ Hecho\n\n");
  await s.close();
}

main().catch((err) => { process.stderr.write(`\n✗ ${err.message}\n`); process.exit(1); });
