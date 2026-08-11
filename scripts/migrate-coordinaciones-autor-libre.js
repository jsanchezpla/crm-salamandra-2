/**
 * migrate-coordinaciones-autor-libre.js — quién registró un acta de coordinación
 * puede ser alguien que no está en la plantilla.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * `coordinations.created_by_id` era NOT NULL y apuntaba a `team_members`. Al
 * traer las 700 actas de Organízate (Aumenta, 02/08/2026) resultó que 171 están
 * firmadas por gente que ya no trabaja en el centro, o por cuentas que no son
 * una persona («NADIE», «FISIO»).
 *
 * Con el campo obligatorio solo había dos salidas, y las dos malas: tirar 171
 * actas de reuniones reales sobre menores reales, o atribuírselas a otro. Se
 * abre una tercera, que es la que pidió Rodrigo: **el nombre en texto libre**.
 * Si hay ficha de equipo, manda la ficha; si no, al menos figura el nombre.
 *
 * Dos cambios, los dos aditivos:
 *   · `created_by_id` deja de ser NOT NULL
 *   · nueva columna `created_by_name VARCHAR(200)`
 *
 * Idempotente: se puede repetir. No-op en schemas sin `coordinations`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-coordinaciones-autor-libre.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-coordinaciones-autor-libre.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function columnInfo(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    { bind: [schema, table, column] }
  );
  return rows[0] ?? null;
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "coordinations"))) {
    log(`· ${schema}: sin coordinaciones, se salta`);
    return;
  }

  await s.query(
    `ALTER TABLE "${schema}"."coordinations" ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(200)`
  );

  const info = await columnInfo(s, schema, "coordinations", "created_by_id");
  if (info && info.is_nullable === "NO") {
    await s.query(`ALTER TABLE "${schema}"."coordinations" ALTER COLUMN created_by_id DROP NOT NULL`);
    log(`✓ ${schema}: created_by_name añadida · created_by_id ya admite vacío`);
  } else {
    log(`· ${schema}: created_by_name lista · created_by_id ya admitía vacío`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Autor libre en coordinaciones · ${schemas.length} schema(s)\n\n`);
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
