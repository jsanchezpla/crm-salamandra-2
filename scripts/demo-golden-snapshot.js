/**
 * demo-golden-snapshot.js — congela el estado ACTUAL del tenant demo como
 * "foto dorada" (schema crm_demo_golden, copia solo-datos de crm_demo).
 *
 * Es la mitad de la demo auto-restaurable: con la foto hecha, cada recarga
 * dura del dashboard del demo restaura crm_demo desde crm_demo_golden
 * (lib/demo/resetDemo.js). Sin foto, el reset queda dormido y la demo se
 * comporta como siempre.
 *
 * Cuándo re-ejecutarlo: SIEMPRE que cambies a propósito los datos del demo
 * (seeds nuevos, rebuild del escaparate...) — si no, la recarga los revierte.
 *
 * Uso local:  node --env-file=.env.local scripts/demo-golden-snapshot.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/demo-golden-snapshot.js
 */

import { Sequelize } from "sequelize";

const SCHEMA = "crm_demo";
const GOLDEN = "crm_demo_golden";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Foto dorada del demo (crm_demo → crm_demo_golden)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const [src] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${SCHEMA}'`
  );
  if (!src.length) {
    process.stderr.write(`✗ No existe el schema ${SCHEMA} en esta base de datos\n`);
    process.exit(1);
  }

  // Alias AS tn: sin él, Sequelize-PG devuelve information_schema raro.
  const [tables] = await s.query(
    `SELECT table_name AS tn FROM information_schema.tables
     WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );

  await s.query(`DROP SCHEMA IF EXISTS "${GOLDEN}" CASCADE`);
  await s.query(`CREATE SCHEMA "${GOLDEN}"`);

  let total = 0;
  for (const { tn } of tables) {
    await s.query(`CREATE TABLE "${GOLDEN}"."${tn}" AS TABLE "${SCHEMA}"."${tn}"`);
    const [[{ n }]] = await s.query(`SELECT count(*)::int AS n FROM "${GOLDEN}"."${tn}"`);
    total += n;
  }
  await s.query(`CREATE TABLE "${GOLDEN}"."_snapshot_meta" AS SELECT now() AS created_at`);

  log(`✓ ${tables.length} tablas congeladas, ${total} filas.`);
  log("A partir de ahora, cada recarga del demo restaura este estado.");
  process.stdout.write("\n ✓ Foto dorada lista\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
