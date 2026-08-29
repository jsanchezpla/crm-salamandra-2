/**
 * migrate-banco-conciliacion.js — el puente entre los cobros del CRM y el
 * dinero de verdad (29/08/2026).
 *
 * Nace de una medición en producción (24/08/2026): desde un cobro no se podía
 * llegar ni al pago de Stripe ni al movimiento del banco — la fila de `payments`
 * no guardaba NINGÚN identificador externo. Y peor: en Aumenta había 14.243
 * facturas y CERO cobros registrados, porque el dinero online ni siquiera
 * cruzaba de `payment_sessions` a Facturación.
 *
 * Hace TRES cosas, todas aditivas e idempotentes:
 *
 *   1. AÑADE a `payments` (donde exista la tabla):
 *        payment_session_id       UUID, UNIQUE — de qué sesión de Stripe nació
 *        stripe_payment_intent_id VARCHAR     — el enlace al panel de Stripe
 *        bank_transaction_id      UUID        — el movimiento del banco casado
 *   2. AÑADE a `costs` (donde exista): bank_transaction_id.
 *   3. CREA `bank_accounts` y `bank_transactions` en TODOS los schemas (los que
 *      tienen `clients`, o sea todos): los modelos están registrados en
 *      `lib/db/tenantDb.js` para todos los tenants, así que sin la tabla el
 *      primer SELECT daría 42P01. Quién puede USAR el banco lo decide el
 *      submódulo `billing_banco` en los endpoints, no la existencia de la
 *      tabla (mismo criterio que whatsapp_messages y notifications).
 *
 * Es CORE en `_module-migrations.js`: las columnas de payments/costs las
 * declara el MODELO para todos los tenants, y dejarlas en el módulo sería el
 * 42703 de siempre. `byTable` no mira el estado del tenant (regla #12).
 *
 * ⚠️ ORDEN DE DEPLOY: VA ANTES del despliegue — los modelos nuevos piden estas
 * columnas y tablas por nombre en cada SELECT:
 *
 *   git pull
 *   docker exec crm-salamandra-app-1 node scripts/migrate-banco-conciliacion.js
 *   ./deploy.sh
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-banco-conciliacion.js
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}

async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
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

// gen_random_uuid(): nativa desde PG13; PG12 vía pgcrypto. Si no se puede
// garantizar, se omite el DEFAULT y el id lo pone Sequelize desde JS.
async function ensureUuidFn(s) {
  try {
    await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    /* sin permiso — seguimos e intentamos detectar */
  }
  try {
    await s.query(`SELECT gen_random_uuid()`);
    return true;
  } catch {
    return false;
  }
}

async function addColumn(s, t, schema, table, column, ddl) {
  if (await columnExists(s, t, schema, table, column)) return;
  await s.query(`ALTER TABLE "${schema}"."${table}" ADD COLUMN ${column} ${ddl}`, { transaction: t });
  log(`✓ ${schema}.${table}: columna ${column} añadida`);
}

async function ensureIndex(s, t, schema, table, indexName, colsSql, unique = false) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`,
    { transaction: t }
  );
  log(`✓ ${schema}: índice ${indexName} creado`);
}

async function processSchema(s, schema) {
  const uuidDefault = await ensureUuidFn(s);
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  await s.transaction(async (t) => {
    // ── 1. El puente en `payments` ──────────────────────────────────────────
    if (await tableExists(s, schema, "payments")) {
      await addColumn(s, t, schema, "payments", "payment_session_id", "UUID");
      await addColumn(s, t, schema, "payments", "stripe_payment_intent_id", "VARCHAR(255)");
      await addColumn(s, t, schema, "payments", "bank_transaction_id", "UUID");
      // UNIQUE sobre la sesión: es la idempotencia del cobro automático. Stripe
      // reintenta los webhooks hasta 3 días; sin esto, un reintento duplicaría
      // el cobro y el total del mes saldría inflado.
      await ensureIndex(s, t, schema, "payments", "payments_payment_session_unique", "(payment_session_id)", true);
      await ensureIndex(s, t, schema, "payments", "payments_bank_tx_idx", "(bank_transaction_id)");
    } else {
      log(`· ${schema}: sin tabla payments (nada que ampliar)`);
    }

    // ── 2. El puente en `costs` ─────────────────────────────────────────────
    if (await tableExists(s, schema, "costs")) {
      await addColumn(s, t, schema, "costs", "bank_transaction_id", "UUID");
      await ensureIndex(s, t, schema, "costs", "costs_bank_tx_idx", "(bank_transaction_id)");
    } else {
      log(`· ${schema}: sin tabla costs (nada que ampliar)`);
    }

    // ── 3. Las tablas del banco ─────────────────────────────────────────────
    if (!(await tableExists(s, schema, "bank_accounts"))) {
      await s.query(
        `CREATE TABLE "${schema}"."bank_accounts" (
          ${idCol},
          requisition_id       VARCHAR(255) NOT NULL,
          institution_id       VARCHAR(255) NOT NULL,
          institution_name     VARCHAR(255),
          account_uid          VARCHAR(255) NOT NULL UNIQUE,
          iban                 VARCHAR(255),
          name                 VARCHAR(255),
          currency             VARCHAR(3),
          status               VARCHAR(20)  NOT NULL DEFAULT 'linked',
          agreement_expires_at TIMESTAMPTZ,
          last_synced_at       TIMESTAMPTZ,
          last_sync_error      TEXT,
          created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.bank_accounts: tabla creada`);
    } else {
      log(`· ${schema}.bank_accounts: ya existía`);
    }

    if (!(await tableExists(s, schema, "bank_transactions"))) {
      await s.query(
        `CREATE TABLE "${schema}"."bank_transactions" (
          ${idCol},
          bank_account_id UUID          NOT NULL REFERENCES "${schema}"."bank_accounts"(id) ON DELETE CASCADE,
          transaction_uid VARCHAR(255)  NOT NULL,
          booking_date    DATE          NOT NULL,
          value_date      DATE,
          amount          NUMERIC(12,2) NOT NULL,
          currency        VARCHAR(3)    NOT NULL DEFAULT 'EUR',
          concept         TEXT,
          counterparty    VARCHAR(255),
          raw             JSONB         NOT NULL DEFAULT '{}'::jsonb,
          created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.bank_transactions: tabla creada`);
    } else {
      log(`· ${schema}.bank_transactions: ya existía`);
    }

    // UNIQUE por cuenta+id del banco: la idempotencia de la sincronización.
    await ensureIndex(s, t, schema, "bank_transactions", "bank_tx_account_uid_unique", "(bank_account_id, transaction_uid)", true);
    await ensureIndex(s, t, schema, "bank_transactions", "bank_tx_booking_date_idx", "(booking_date)");
  });

  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: conciliación bancaria (banco + enlaces en cobros/gastos)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "clients");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla clients.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schema(s): ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla clients (se omiten): ${skipped.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
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
