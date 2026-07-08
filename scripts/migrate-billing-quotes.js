/**
 * migrate-billing-quotes.js
 *
 * Crea la tabla `quotes` (Presupuestos) en los tenants con el módulo
 * `billing` activo. Primera pieza del rediseño del módulo de Facturación.
 *
 * - Lee la lista de tenants con `billing` habilitado desde
 *   master.tenant_modules en runtime (nunca hardcode; difiere local↔prod).
 * - Idempotente: CREATE TYPE / TABLE / INDEX con guardas de existencia.
 * - Por schema independiente (sin transacción global): si uno falla, los
 *   demás siguen. Los nombres de tipo/constraint coinciden con los que
 *   generaría sequelize.sync() para tenants nuevos (enum_quotes_status,
 *   quotes_number_key), evitando divergencia sync↔migración.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-quotes.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-quotes.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function typeExists(s, schema, typeName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [typeName, schema] }
  );
  return rows.length > 0;
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function indexExists(s, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  const result = { tenant: schema.replace(/^crm_/, ""), enum: "—", table: "—", indexes: "—" };

  // 1) ENUM de estado
  if (await typeExists(s, schema, "enum_quotes_status")) {
    result.enum = "ya existía";
  } else {
    await s.query(
      `CREATE TYPE "${schema}"."enum_quotes_status" AS ENUM
       ('draft','sent','viewed','accepted','rejected','expired','converted')`
    );
    result.enum = "creado";
  }

  // 2) Tabla
  if (await tableExists(s, schema, "quotes")) {
    result.table = "ya existía";
  } else {
    await s.query(`
      CREATE TABLE "${schema}"."quotes" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL,
        project_id UUID,
        employee_id UUID,
        series VARCHAR(8) NOT NULL DEFAULT 'P',
        number VARCHAR(255) NOT NULL UNIQUE,
        status "${schema}"."enum_quotes_status" NOT NULL DEFAULT 'draft',
        issue_date DATE NOT NULL,
        valid_until DATE,
        lines JSONB NOT NULL DEFAULT '[]'::jsonb,
        tax_base NUMERIC(12,2) NOT NULL DEFAULT 0,
        vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        sent_at TIMESTAMPTZ,
        viewed_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        converted_invoice_id UUID,
        converted_at TIMESTAMPTZ,
        notes TEXT,
        custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    result.table = "creada";
  }

  // 3) Índices
  const idx = [
    { name: "quotes_client_idx", ddl: `CREATE INDEX "quotes_client_idx" ON "${schema}"."quotes"(client_id)` },
    { name: "quotes_status_idx", ddl: `CREATE INDEX "quotes_status_idx" ON "${schema}"."quotes"(status)` },
    { name: "quotes_issue_date_idx", ddl: `CREATE INDEX "quotes_issue_date_idx" ON "${schema}"."quotes"(issue_date)` },
  ];
  let created = 0;
  for (const i of idx) {
    if (!(await indexExists(s, schema, i.name))) {
      await s.query(i.ddl);
      created++;
    }
  }
  result.indexes = `${created} nuevos / ${idx.length}`;

  return result;
}

async function fetchBillingSlugs(s) {
  const [rows] = await s.query(`
    SELECT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.module_key = 'billing' AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Presupuestos (quotes) — Facturación  \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Tenants con módulo billing activo...");
  const slugs = await fetchBillingSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con billing. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  const results = [];
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    process.stdout.write(`\n· Schema ${schema}\n`);
    try {
      const r = await processSchema(sequelize, schema);
      log(`  enum: ${r.enum} · tabla: ${r.table} · índices: ${r.indexes}`);
      results.push(r);
    } catch (err) {
      log(`  ✗ Error en ${schema}: ${err.message} — se salta, sigue con el resto`);
      results.push({ tenant: slug, enum: "ERROR", table: err.message, indexes: "—" });
    }
  }

  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada                          \n");
  process.stdout.write("════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
