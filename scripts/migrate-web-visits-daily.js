/**
 * migrate-web-visits-daily.js — crea la tabla `web_visits_daily` (modelo
 * WebVisitDaily) en TODOS los schemas crm_*.
 *
 * Guarda la foto diaria de las visitas de la web. Existe porque Cloudflare Web
 * Analytics solo conserva 7 días: el histórico largo (mes, trimestre, año) lo
 * construye el CRM copiando cada día lo que Cloudflare da mientras lo da.
 *
 * Va en el módulo `analytics`. Es aditiva e idempotente (CREATE ... IF NOT
 * EXISTS + comprobaciones), así que en un schema que ya la tiene es un no-op y
 * en uno que no usa el módulo solo deja una tabla vacía.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-web-visits-daily.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-web-visits-daily.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function processSchema(s, schema, uuidDefault) {
  if (await tableExists(s, schema, "web_visits_daily")) {
    log(`· ${schema}: ya existe`);
    return;
  }

  const pk = uuidDefault ? `DEFAULT gen_random_uuid()` : "";

  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."web_visits_daily" (
      id          UUID PRIMARY KEY ${pk},
      fecha       DATE NOT NULL,
      dimension   VARCHAR(20) NOT NULL,
      valor       VARCHAR(255) NOT NULL DEFAULT '',
      visitas     INTEGER NOT NULL DEFAULT 0,
      vistas      INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Lo que hace idempotente a la captura: repetir una pasada actualiza la fila
  // en vez de duplicarla. `valor` es NOT NULL (cadena vacía en la dimensión
  // `total`) precisamente para esto: dos NULL no chocan en un índice único de
  // PostgreSQL, así que con NULL el mismo día podría entrar dos veces.
  await s.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "web_visits_daily_unique"
      ON "${schema}"."web_visits_daily" (fecha, dimension, valor)
  `);

  await s.query(`
    CREATE INDEX IF NOT EXISTS "web_visits_daily_dimension_fecha"
      ON "${schema}"."web_visits_daily" (dimension, fecha)
  `);

  log(`✓ ${schema}: tabla web_visits_daily creada`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("Falta DATABASE_URL\n");
    process.exit(1);
  }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    if (!uuidDefault) {
      log("⚠ gen_random_uuid() no disponible: el id lo pondrá Sequelize desde la app");
    }

    const schemas = await listSchemas(s);
    header(`web_visits_daily en ${schemas.length} schema(s)`);
    for (const schema of schemas) await processSchema(s, schema, uuidDefault);

    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
