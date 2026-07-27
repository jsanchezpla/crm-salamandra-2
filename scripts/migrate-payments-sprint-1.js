/**
 * migrate-payments-sprint-1.js — crea las tablas de la capa de pagos online
 * (`payment_sessions` y `stripe_webhook_events`) en TODOS los schemas crm_*.
 *
 * Va en CORE (transversal) por el mismo motivo que `notifications`: los modelos
 * PaymentSession y StripeWebhookEvent quedan registrados en `lib/db/tenantDb.js`
 * para todos los tenants, así que la tabla debe existir en todos los schemas o
 * cualquier consulta reventaría con 42703.
 *
 * Aditiva e idempotente (CREATE ... IF NOT EXISTS + comprobaciones).
 *
 * Detalles que importan:
 *  · `amount` en CÉNTIMOS (INTEGER) + CHECK > 0: nada de decimales para dinero.
 *  · `stripe_checkout_session_id` y `stripe_payment_intent_id` UNIQUE: primera
 *    barrera contra el doble cobro si Stripe reintenta un webhook.
 *  · `stripe_event_id` UNIQUE: es lo que hace idempotente el webhook. En Postgres
 *    varios NULL no colisionan, así que las filas sin id de Stripe conviven.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-payments-sprint-1.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-payments-sprint-1.js
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
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}
async function enumTypeExists(s, name, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [name, schema] }
  );
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
  const enumName = "enum_payment_sessions_status";
  if (!(await enumTypeExists(s, enumName, schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."${enumName}" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'expired')`
    );
    log(`✓ ${schema} enum ${enumName}: creado`);
  }

  await s.transaction(async (t) => {
    const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

    if (!(await tableExists(s, t, schema, "payment_sessions"))) {
      await s.query(
        `CREATE TABLE "${schema}"."payment_sessions" (
          ${idCol},
          entity_type VARCHAR(255) NOT NULL,
          entity_id UUID NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          currency VARCHAR(3) NOT NULL DEFAULT 'eur',
          status "${schema}"."${enumName}" NOT NULL DEFAULT 'pending',
          description VARCHAR(255),
          stripe_checkout_session_id VARCHAR(255) UNIQUE,
          stripe_payment_intent_id VARCHAR(255) UNIQUE,
          paid_at TIMESTAMPTZ,
          stripe_refund_id VARCHAR(255),
          refund_amount INTEGER,
          refunded_at TIMESTAMPTZ,
          refund_reason TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.payment_sessions: tabla creada`);
    } else {
      log(`· ${schema}.payment_sessions: ya existe`);
    }

    if (!(await tableExists(s, t, schema, "stripe_webhook_events"))) {
      await s.query(
        `CREATE TABLE "${schema}"."stripe_webhook_events" (
          ${idCol},
          stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
          type VARCHAR(255) NOT NULL,
          outcome VARCHAR(255),
          processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.stripe_webhook_events: tabla creada`);
    } else {
      log(`· ${schema}.stripe_webhook_events: ya existe`);
    }

    await ensureIndex(s, t, schema, "payment_sessions_entity_idx",
      `CREATE INDEX "payment_sessions_entity_idx" ON "${schema}"."payment_sessions" (entity_type, entity_id)`);
    await ensureIndex(s, t, schema, "payment_sessions_status_idx",
      `CREATE INDEX "payment_sessions_status_idx" ON "${schema}"."payment_sessions" (status)`);

    // Precio del tipo de cita, EN CÉNTIMOS. Solo donde exista `event_types` (es
    // decir, tenants con el módulo citas): en el resto es un no-op.
    // NULL = gratis → el flujo de reserva no pide pago y los tenants que no cobran
    // siguen exactamente igual que antes.
    if (await tableExists(s, t, schema, "event_types")) {
      if (!(await columnExists(s, t, schema, "event_types", "price"))) {
        await s.query(
          `ALTER TABLE "${schema}"."event_types" ADD COLUMN price INTEGER CHECK (price IS NULL OR price >= 0)`,
          { transaction: t }
        );
        log(`✓ ${schema}.event_types.price: columna creada`);
      } else {
        log(`· ${schema}.event_types.price: ya existe`);
      }
    }
  });

  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: capa de pagos (todos crm_*)\n");
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
