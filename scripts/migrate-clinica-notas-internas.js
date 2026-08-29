/**
 * migrate-clinica-notas-internas.js — las NOTAS INTERNAS del registro de sesión.
 *
 * Añade a `clinic_sessions`, en cada tenant con `clinica` o `pacientes` activo:
 *   - `internal_notes` TEXT NULL: lo que el equipo anota para sí mismo.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (29/08/2026, por Rodrigo): «no siempre pueden ver todo
 * porque en ocasiones ponemos comentarios que son solo de nuestro interés
 * (falta de implicación familiar, estados de los padres, actitudes…)».
 *
 * Hasta hoy ese texto no tenía sitio propio y acababa en «Observaciones», que
 * es justo el apartado que viaja al anexo del informe y al volcado que redacta
 * el borrador — o sea, al PDF que recibe la familia. Con columna propia la
 * regla es la misma que la de `prep_text`: material interno del equipo, no sale
 * del CRM.
 *
 * Sin backfill: no hay forma de adivinar qué parte de una observación vieja era
 * interna, y moverla a ojo sería inventar. Las 22.045 sesiones que ya existen
 * se quedan como están, con la columna vacía.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Lee los tenants de master.tenants en
 * runtime (regla #12).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-notas-internas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-notas-internas.js
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
    WHERE tm.enabled = TRUE AND tm.module_key IN ('clinica','pacientes')
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "clinic_sessions"))) {
    log(`✗ ${schema}: no existe clinic_sessions. Se salta.`);
    return;
  }

  await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS internal_notes TEXT`);
  log(`✓ ${schema}.clinic_sessions: columna internal_notes asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: notas internas del registro de sesión\n");
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
