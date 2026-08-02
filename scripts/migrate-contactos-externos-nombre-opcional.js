/**
 * migrate-contactos-externos-nombre-opcional.js — un contacto externo puede
 * constar solo por su papel.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * `external_contacts.name` era NOT NULL, y tiene sentido para un alta hecha a
 * mano. Pero al traer las 700 actas de coordinación de Organízate (02/08/2026)
 * los asistentes venían escritos a pelo dentro del texto, y de 1.312 apuntes
 * muchos traen solo la mitad del dato: «Orientadora Lidia», sí, pero también
 * «Tutora» a secas o «Blanca» a secas.
 *
 * Decisión de Rodrigo: entran igual, con el hueco que falte en blanco. Saber que
 * en esa reunión estuvo la tutora del colegio vale aunque nadie apuntara su
 * nombre, y se puede completar después desde la ficha del paciente.
 *
 * Lo que sí se impide, con un CHECK, es un contacto sin nombre Y sin papel: eso
 * no identifica a nadie y solo ensucia la agenda.
 *
 * Idempotente. No-op en schemas sin `external_contacts`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-contactos-externos-nombre-opcional.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-contactos-externos-nombre-opcional.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function constraintExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.conname=$2`,
    { bind: [schema, name] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "external_contacts"))) {
    log(`· ${schema}: sin contactos externos, se salta`);
    return;
  }

  const [[col]] = await s.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='external_contacts' AND column_name='name'`,
    { bind: [schema] }
  );
  if (col?.is_nullable === "NO") {
    await s.query(`ALTER TABLE "${schema}"."external_contacts" ALTER COLUMN name DROP NOT NULL`);
    log(`✓ ${schema}: name ya admite vacío`);
  } else {
    log(`· ${schema}: name ya admitía vacío`);
  }

  // Nombre o papel: uno de los dos, al menos.
  if (!(await constraintExists(s, schema, "external_contacts_algo_check"))) {
    await s.query(`
      ALTER TABLE "${schema}"."external_contacts"
        ADD CONSTRAINT external_contacts_algo_check
        CHECK (coalesce(name, '') <> '' OR coalesce(role, '') <> '')
    `);
    log(`✓ ${schema}: CHECK «nombre o papel» añadido`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Contactos externos con nombre opcional · ${schemas.length} schema(s)\n\n`);
    for (const schema of schemas) await processSchema(s, schema);
    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
