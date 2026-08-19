/**
 * seed-retorika.js — Inicializa el schema crm_retorika y crea el primer curso
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar datos.
 * Requiere que el tenant exista en master (ejecutar seed-master.js primero).
 *
 * Uso: npm run db:seed:retorika
 */

import { Sequelize } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = "retorika";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function createSchemaIfNotExists(schemaName) {
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await rawDb.close();
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Retorika — Seed schema crm_retorika     \n");
  process.stdout.write("════════════════════════════════════════\n");

  // ── 1. Crear schema si no existe ──────────────────────────────────────────
  header(`Creando schema crm_${SLUG}...`);
  await createSchemaIfNotExists(`crm_${SLUG}`);
  log(`✓ Schema "crm_${SLUG}" listo`);

  // ── 2. Sincronizar tablas ─────────────────────────────────────────────────
  header("Sincronizando tablas...");
  const { sequelize, models } = getTenantDb(SLUG);
  await sequelize.sync({ force: false });
  log(`✓ Todas las tablas del schema crm_${SLUG} sincronizadas`);

  // ── 3. Curso "IA y comunicación política" ─────────────────────────────────
  header("Verificando curso...");
  const [course, courseCreated] = await models.Course.findOrCreate({
    where: { wpCourseId: 6434 },
    defaults: {
      name: "IA y comunicación política",
      wpCourseId: 6434,
      wcProductId: 6435,
      active: true,
    },
  });
  log(
    `${courseCreated ? "✓ Creado" : "· Ya existe"} curso "${course.name}" (wpCourseId: ${course.wpCourseId}, wcProductId: ${course.wcProductId})`
  );

  // ── 4. Resumen ────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Schema:   crm_${SLUG}\n`);
  process.stdout.write(`  Curso:    ${course.name}\n`);
  process.stdout.write(`  WP ID:    ${course.wpCourseId}\n`);
  process.stdout.write(`  WC ID:    ${course.wcProductId}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
