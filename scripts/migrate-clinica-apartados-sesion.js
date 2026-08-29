/**
 * migrate-clinica-apartados-sesion.js — los APARTADOS del registro de sesión.
 *
 * Añade a `clinic_sessions`, en cada tenant con `clinica` o `pacientes` activo:
 *   - `content_sections` JSONB NOT NULL DEFAULT '{}': la foto de con qué
 *     apartados se escribió el registro, y el cuerpo de los apartados NUEVOS.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (28-29/08/2026, por Rodrigo): que un informe y un registro
 * sean «un montón de título-cuerpo seguidos», que el centro pueda guardarse sus
 * propias plantillas y que además se puedan añadir apartados sueltos a un
 * documento concreto sin guardarlos en ninguna plantilla.
 *
 * El informe ya tenía dónde: `clinical_reports.content_sections` es JSONB y
 * admite cualquier clave. El registro de sesión NO tenía nada equivalente —sus
 * campos son columnas desde el primer día—, así que esta migración le da el
 * mismo cajón, con el mismo nombre a propósito: los dos documentos se leen y se
 * imprimen con el mismo código (`lib/clinica/plantillas.js`).
 *
 * Sin backfill, y esto es lo importante: los apartados de SIEMPRE —objetivos,
 * actividades, desempeño y las cuatro observaciones— se quedan en sus columnas
 * de toda la vida, que es de donde comen el volcado a informes, las
 * estadísticas y el anexo. Aquí solo van los apartados nuevos. Las 22.045
 * sesiones de Aumenta arrancan con `{}` y se siguen leyendo, imprimiendo y
 * volcando exactamente igual: sin foto de apartados se cae a la plantilla del
 * centro y, si no la ha tocado, a los siete de fábrica.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Lee los tenants de master.tenants en
 * runtime (regla #12).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-apartados-sesion.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-apartados-sesion.js
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

  await s.query(
    `ALTER TABLE "${schema}"."clinic_sessions"
       ADD COLUMN IF NOT EXISTS content_sections JSONB NOT NULL DEFAULT '{}'::jsonb`
  );
  log(`✓ ${schema}.clinic_sessions: columna content_sections asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: apartados del registro de sesión\n");
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
