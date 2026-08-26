/**
 * migrate-correo-herramientas.js — crea las tablas de la pantalla /correo en
 * TODOS los schemas crm_*: `correo_listas` (listas de destinatarios guardadas),
 * `correo_plantillas` (asunto+cuerpo reutilizables) y `correo_firmas` (el pie
 * de firma de cada persona del equipo).
 *
 * Sprint del 26/08/2026 (Rodrigo): listas personalizadas, plantillas ilimitadas
 * y pies de firma con adjuntado automático.
 *
 * Va en CORE, no en un módulo: los tres modelos están registrados para todos
 * los tenants (la pantalla se ve con `clients` O con `outreach`, y una tabla
 * que falta es un 42703 esperando). Sin FK: `correo_firmas.user_id` es
 * referencia lógica a master.users, igual que notifications.
 *
 * Idempotente (CREATE ... IF NOT EXISTS + comprobaciones). Aditiva.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-correo-herramientas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-correo-herramientas.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return acotarSchemas(rows.map((r) => r.schema_name));
}
async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
    transaction: t,
  });
  return rows.length > 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}
async function ensureIndex(s, t, schema, indexName, sql) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(sql, { transaction: t });
  log(`✓ ${schema} index ${indexName}: creado`);
}

async function processSchema(s, schema, uuidDefault) {
  await s.transaction(async (t) => {
    const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

    if (!(await tableExists(s, t, schema, "correo_listas"))) {
      await s.query(
        `CREATE TABLE "${schema}"."correo_listas" (
          ${idCol},
          nombre VARCHAR(80) NOT NULL,
          destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.correo_listas: tabla creada`);
    } else {
      log(`· ${schema}.correo_listas: ya existe`);
    }
    await ensureIndex(s, t, schema, "correo_listas_nombre_idx",
      `CREATE INDEX "correo_listas_nombre_idx" ON "${schema}"."correo_listas" (nombre)`);

    if (!(await tableExists(s, t, schema, "correo_plantillas"))) {
      await s.query(
        `CREATE TABLE "${schema}"."correo_plantillas" (
          ${idCol},
          nombre VARCHAR(120) NOT NULL,
          asunto VARCHAR(200),
          cuerpo TEXT,
          created_by VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.correo_plantillas: tabla creada`);
    } else {
      log(`· ${schema}.correo_plantillas: ya existe`);
    }
    await ensureIndex(s, t, schema, "correo_plantillas_nombre_idx",
      `CREATE INDEX "correo_plantillas_nombre_idx" ON "${schema}"."correo_plantillas" (nombre)`);

    if (!(await tableExists(s, t, schema, "correo_firmas"))) {
      await s.query(
        `CREATE TABLE "${schema}"."correo_firmas" (
          ${idCol},
          user_id UUID NOT NULL,
          html TEXT,
          texto TEXT,
          imagen JSONB,
          updated_by VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.correo_firmas: tabla creada`);
    } else {
      log(`· ${schema}.correo_firmas: ya existe`);
    }
    await ensureIndex(s, t, schema, "correo_firmas_user_id",
      `CREATE UNIQUE INDEX "correo_firmas_user_id" ON "${schema}"."correo_firmas" (user_id)`);
  });
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: tablas de /correo — listas, plantillas y firmas (todos crm_*)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const uuidDefault = await ensureUuidFn(s);

  const schemas = await listSchemas(s);
  if (schemas.length === 0) {
    log("· No hay schemas crm_*.");
    await s.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(`Schema ${schema}`);
    try {
      await processSchema(s, schema, uuidDefault);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
