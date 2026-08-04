/**
 * migrate-incidencias-verificacion.js — la VERIFICACIÓN de una incidencia.
 *
 * Añade a `incidencias`, en cada tenant con `clinica` o `pacientes` activo:
 *   - `verification` VARCHAR(20): 'resuelta' | 'parcial' | 'no_resuelta', NULL
 *     mientras nadie la haya comprobado.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (04/08/2026): registrar la acción realizada es la mitad del
 * trabajo; la otra mitad es decir si funcionó. El `status` de siempre solo
 * sabía de pendiente/en proceso/resuelta, y no tenía sitio para «se arregló a
 * medias», que es el resultado más común de una incidencia organizativa.
 *
 * `verification` NO sustituye a `status`: lo GOBIERNA. La UI enseña un solo
 * control y el estado se mueve solo (resuelta → resolved, parcial y no_resuelta
 * → in_progress). Dos controles que dicen cosas parecidas es la forma más
 * rápida de que una incidencia quede marcada como resuelta y pendiente a la vez.
 *
 * Backfill: las incidencias ya resueltas pasan a `verification = 'resuelta'`.
 * Alguien las cerró; dejarlas «sin verificar» las sacaría en la lista de
 * pendientes de comprobar el primer día, que es justo el ruido que nadie mira.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS + backfill con WHERE ... IS NULL).
 * Lee los tenants de master.tenants en runtime (regla #12).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-incidencias-verificacion.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-incidencias-verificacion.js
 */

import { Sequelize } from "sequelize";

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
  return rows.map((r) => r.slug);
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "incidencias"))) {
    log(`✗ ${schema}: no existe incidencias. Se salta.`);
    return;
  }

  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."incidencias" ADD COLUMN IF NOT EXISTS verification VARCHAR(20)`,
      { transaction: t }
    );
    log(`✓ ${schema}.incidencias: columna verification asegurada`);

    const [, meta] = await s.query(
      `UPDATE "${schema}"."incidencias"
       SET verification = 'resuelta'
       WHERE verification IS NULL AND status = 'resolved'`,
      { transaction: t }
    );
    log(`✓ ${schema}.incidencias: ${meta?.rowCount ?? 0} resueltas marcadas como verificadas`);
  });

  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: verificación de incidencias\n");
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
    await processSchema(sequelize, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
