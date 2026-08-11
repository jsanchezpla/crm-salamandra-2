/**
 * migrate-clinica-performance-roles.js — desempeño configurable por ROLES.
 *
 * Añade a `performance_metrics`, en cada tenant con módulo `clinica` o
 * `pacientes` activo (el mismo criterio que gate-a los endpoints de
 * performance y que usa migrate-incentive-items.js):
 *   - `role_key`   VARCHAR(64): rol de desempeño con el que se evaluó la fila;
 *   - `area_scores` JSONB: puntuaciones por clave de área (fuente de verdad
 *     nueva; las columnas legacy area1_score…area8_score SE QUEDAN como espejo
 *     y fallback de lectura).
 *
 * Backfill (solo filas anteriores a la migración):
 *   - area_scores = jsonb_strip_nulls(jsonb_build_object('area1', area1_score,
 *     …, 'area8', area8_score)) — sin area5, que nunca existió;
 *   - role_key = COALESCE(role_key, 'terapeuta') — el rol legacy sintetizado.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS + backfill por WHERE ... IS NULL).
 * Selecciona tenants leyendo master.tenants en runtime (regla #12, NUNCA
 * hardcodear slugs). El backfill no lleva inputs de usuario.
 * La relanza `ensure-tenant-schema.js` cuando un tenant estrena clinica.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-performance-roles.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-performance-roles.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`
    SELECT DISTINCT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key IN ('clinica','pacientes')
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "performance_metrics"))) {
    log(`✗ ${schema}: no existe performance_metrics. Se salta.`);
    return;
  }

  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."performance_metrics" ADD COLUMN IF NOT EXISTS role_key VARCHAR(64)`,
      { transaction: t }
    );
    await s.query(
      `ALTER TABLE "${schema}"."performance_metrics" ADD COLUMN IF NOT EXISTS area_scores JSONB`,
      { transaction: t }
    );
    log(`✓ ${schema}.performance_metrics: columnas role_key y area_scores aseguradas`);

    // Backfill de filas anteriores: el JSONB replica las columnas legacy (sin
    // nulls) y el rol pasa a ser el legacy 'terapeuta'. Sin inputs de usuario.
    const [, meta] = await s.query(
      `UPDATE "${schema}"."performance_metrics"
       SET area_scores = COALESCE(area_scores, jsonb_strip_nulls(jsonb_build_object(
             'area1', area1_score,
             'area2', area2_score,
             'area3', area3_score,
             'area4', area4_score,
             'area6', area6_score,
             'area7', area7_score,
             'area8', area8_score
           ))),
           role_key = COALESCE(role_key, 'terapeuta')
       WHERE area_scores IS NULL OR role_key IS NULL`,
      { transaction: t }
    );
    log(`✓ ${schema}.performance_metrics: backfill de ${meta?.rowCount ?? 0} filas`);
  });

  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: performance_metrics por roles (role_key + area_scores)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con clinica/pacientes activo.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
    if (!(await schemaExists(sequelize, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(sequelize, schema);
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
