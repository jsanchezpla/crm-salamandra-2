/**
 * migrate-stage-to-string.js
 *
 * Convierte la columna `stage` de leads de ENUM a VARCHAR(50) en todos los schemas de tenant.
 * Necesario porque se añadieron nuevos estados (in_progress, demo_scheduled, demo_done, closed_yes, closed_no)
 * que el ENUM original no admitía.
 *
 * Uso: node scripts/migrate-stage-to-string.js
 */

import { Sequelize } from "sequelize";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write("ERROR: DATABASE_URL no definida en .env\n");
  process.exit(1);
}

const TENANT_SLUGS = ["demo", "quality_energy", "aumenta", "abarcaia", "retorika"];

const db = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: false,
});

async function migrateSchema(slug) {
  const schema = `crm_${slug}`;

  // Comprobar si la columna es ENUM
  const [rows] = await db.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = '${schema}'
      AND table_name = 'leads'
      AND column_name = 'stage'
    LIMIT 1;
  `);

  if (rows.length === 0) {
    process.stdout.write(`  · ${schema}: tabla leads no existe, saltando\n`);
    return;
  }

  const dataType = rows[0].data_type;

  if (dataType === "character varying") {
    process.stdout.write(`  · ${schema}: stage ya es VARCHAR, sin cambios\n`);
    return;
  }

  // Convertir ENUM → VARCHAR
  await db.query(
    `ALTER TABLE "${schema}".leads ALTER COLUMN stage TYPE VARCHAR(50) USING stage::text;`
  );

  // Eliminar el tipo ENUM huérfano
  await db.query(
    `DROP TYPE IF EXISTS "${schema}"."enum_leads_stage";`
  ).catch(() => {
    // El tipo puede estar en search_path por defecto; intentar sin schema
  });

  process.stdout.write(`  ✓ ${schema}: ENUM → VARCHAR(50)\n`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Migración: stage ENUM → VARCHAR(50)    \n");
  process.stdout.write("════════════════════════════════════════\n\n");

  for (const slug of TENANT_SLUGS) {
    await migrateSchema(slug);
  }

  await db.close();

  process.stdout.write("\n✓ Migración completada\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
