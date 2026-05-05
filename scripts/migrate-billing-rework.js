/**
 * migrate-billing-rework.js
 *
 * Sprint Billing rework: añade IVA real, series de facturación, libro IVA,
 * cobros parciales correctos, datos fiscales por cliente y settings de tenant.
 *
 * Estrategia:
 *   - ALTER TYPE (RENAME VALUE / ADD VALUE) FUERA de la transacción global,
 *     en autocommit, porque en PG <12 ADD VALUE no es transaccional.
 *   - El resto de cambios (ADD COLUMN, CREATE TABLE, INSERT defaults,
 *     backfill) dentro de UNA transacción global. Si algo falla, rollback
 *     completo.
 *   - Idempotente. Lee slugs activos desde master.tenants.
 *
 * Uso:
 *   npm run db:migrate:billing-rework         (local)
 *   npm run db:migrate:billing-rework:prod    (producción)
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers de introspección ──────────────────────────────────────────────

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}
async function enumHasValue(s, enumTypeName, value, schema = null) {
  // El enum vive en el schema del tenant. Filtramos por nspname.
  const sql = schema
    ? `SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = $1 AND e.enumlabel = $2 AND n.nspname = $3`
    : `SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = $1 AND e.enumlabel = $2`;
  const bind = schema ? [enumTypeName, value, schema] : [enumTypeName, value];
  const [rows] = await s.query(sql, { bind });
  return rows.length > 0;
}
async function enumTypeExists(s, enumTypeName, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND n.nspname = $2`,
    { bind: [enumTypeName, schema] }
  );
  return rows.length > 0;
}

// ─── Fase A: ALTER TYPE fuera de transacción ───────────────────────────────

async function alterEnums(s, schema) {
  // Invoice.status: rename 'partial' → 'partially_paid', add 'issued', 'rectified'
  if (await enumTypeExists(s, "enum_invoices_status", schema)) {
    if (await enumHasValue(s, "enum_invoices_status", "partial", schema)
        && !(await enumHasValue(s, "enum_invoices_status", "partially_paid", schema))) {
      await s.query(`ALTER TYPE "${schema}"."enum_invoices_status" RENAME VALUE 'partial' TO 'partially_paid'`);
      log(`✓ ${schema} enum invoices.status: 'partial' → 'partially_paid'`);
    } else {
      log(`· ${schema} enum invoices.status: 'partial' ya renombrado o ausente`);
    }
    for (const v of ["issued", "rectified"]) {
      if (!(await enumHasValue(s, "enum_invoices_status", v, schema))) {
        await s.query(`ALTER TYPE "${schema}"."enum_invoices_status" ADD VALUE IF NOT EXISTS '${v}'`);
        log(`✓ ${schema} enum invoices.status: añadido '${v}'`);
      } else {
        log(`· ${schema} enum invoices.status: '${v}' ya existe`);
      }
    }
  } else {
    log(`· ${schema}: tabla invoices o su enum no existe, saltando`);
  }

  // Cost.category: añadir 'opex'
  if (await enumTypeExists(s, "enum_costs_category", schema)) {
    if (!(await enumHasValue(s, "enum_costs_category", "opex", schema))) {
      await s.query(`ALTER TYPE "${schema}"."enum_costs_category" ADD VALUE IF NOT EXISTS 'opex'`);
      log(`✓ ${schema} enum costs.category: añadido 'opex'`);
    } else {
      log(`· ${schema} enum costs.category: 'opex' ya existe`);
    }
  }

  // Payment.status: añadir 'refunded'
  if (await enumTypeExists(s, "enum_payments_status", schema)) {
    if (!(await enumHasValue(s, "enum_payments_status", "refunded", schema))) {
      await s.query(`ALTER TYPE "${schema}"."enum_payments_status" ADD VALUE IF NOT EXISTS 'refunded'`);
      log(`✓ ${schema} enum payments.status: añadido 'refunded'`);
    } else {
      log(`· ${schema} enum payments.status: 'refunded' ya existe`);
    }
  }

  // InvoiceSeries.kind: crear ENUM si no existe. La tabla invoice_series se
  // crea más abajo en fase B (CREATE TABLE) usando este tipo. Mantenemos la
  // creación aquí porque CREATE TYPE no es transaccional cuando se combina
  // con ADD VALUE en la misma sesión, y porque otros tenants pueden tener
  // ya la tabla con la columna como VARCHAR (caso del bug histórico que
  // arregla scripts/migrate-billing-fix-kind-enum.js).
  if (!(await enumTypeExists(s, "enum_invoice_series_kind", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_invoice_series_kind" AS ENUM ('normal', 'rectificative')`,
    );
    log(`✓ ${schema} enum invoice_series.kind: tipo creado`);
  } else {
    log(`· ${schema} enum invoice_series.kind: ya existe`);
  }
}

// ─── Fase B: ADD COLUMN, CREATE TABLE, backfill (todo en transacción) ──────

async function addColumnIfNotExists(s, t, schema, table, column, ddl) {
  if (!(await tableExists(s, t, schema, table))) {
    log(`· ${schema}.${table}: tabla no existe, salto ${column}`);
    return;
  }
  if (await columnExists(s, t, schema, table, column)) {
    log(`· ${schema}.${table}.${column}: ya existe`);
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."${table}" ADD COLUMN "${column}" ${ddl}`, { transaction: t });
  log(`✓ ${schema}.${table}.${column}: añadida`);
}

async function processSchemaInTx(s, t, schema) {
  // ── invoices: nuevas columnas ──────────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "invoices", "series", `VARCHAR(8) NOT NULL DEFAULT 'F'`);
  await addColumnIfNotExists(s, t, schema, "invoices", "tax_base", `NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await addColumnIfNotExists(s, t, schema, "invoices", "paid_amount", `NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await addColumnIfNotExists(s, t, schema, "invoices", "rectifies_invoice_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "invoices", "rectified_by_invoice_id", `UUID`);

  // ── costs: nuevas columnas ─────────────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "costs", "tax_base", `NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await addColumnIfNotExists(s, t, schema, "costs", "vat_rate", `NUMERIC(5,2) NOT NULL DEFAULT 21`);
  await addColumnIfNotExists(s, t, schema, "costs", "tax_amount", `NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await addColumnIfNotExists(s, t, schema, "costs", "total", `NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await addColumnIfNotExists(s, t, schema, "costs", "vat_deductible", `BOOLEAN NOT NULL DEFAULT TRUE`);
  await addColumnIfNotExists(s, t, schema, "costs", "incurred_at", `DATE`);
  await addColumnIfNotExists(s, t, schema, "costs", "client_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "costs", "inventory_product_id", `UUID`);
  await addColumnIfNotExists(s, t, schema, "costs", "attachment_url", `VARCHAR(255)`);

  // ── clients: campos fiscales ───────────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "clients", "fiscal_name", `VARCHAR(255)`);
  await addColumnIfNotExists(s, t, schema, "clients", "fiscal_address", `VARCHAR(255)`);
  await addColumnIfNotExists(s, t, schema, "clients", "fiscal_city", `VARCHAR(255)`);
  await addColumnIfNotExists(s, t, schema, "clients", "fiscal_zip", `VARCHAR(20)`);
  await addColumnIfNotExists(s, t, schema, "clients", "fiscal_country", `VARCHAR(2) NOT NULL DEFAULT 'ES'`);

  // ── team_members: monthly_salary ───────────────────────────────────────
  await addColumnIfNotExists(s, t, schema, "team_members", "monthly_salary", `NUMERIC(10,2)`);

  // ── invoice_series ─────────────────────────────────────────────────────
  // El ENUM enum_invoice_series_kind se crea en fase A (autocommit) antes
  // de que entremos aquí. Usamos ese tipo directamente en lugar de VARCHAR(20)
  // para mantener BD y modelo Sequelize alineados (evita que un sync({alter:true})
  // intente convertir tipos y reviente).
  if (!(await tableExists(s, t, schema, "invoice_series"))) {
    await s.query(`
      CREATE TABLE "${schema}"."invoice_series" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(8) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        prefix VARCHAR(16) NOT NULL,
        year INTEGER NOT NULL,
        next_number INTEGER NOT NULL DEFAULT 1,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        kind "${schema}"."enum_invoice_series_kind" NOT NULL DEFAULT 'normal',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.invoice_series: tabla creada`);
  } else {
    log(`· ${schema}.invoice_series: ya existe`);
  }

  // ── tenant_billing_settings ────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "tenant_billing_settings"))) {
    await s.query(`
      CREATE TABLE "${schema}"."tenant_billing_settings" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fiscal_name VARCHAR(255),
        tax_id VARCHAR(255),
        fiscal_address VARCHAR(255),
        fiscal_city VARCHAR(255),
        fiscal_zip VARCHAR(20),
        fiscal_country VARCHAR(2) NOT NULL DEFAULT 'ES',
        default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 21,
        available_vat_rates JSONB NOT NULL DEFAULT '[21,10,4,0]',
        default_payment_terms_days INTEGER NOT NULL DEFAULT 30,
        invoice_footer_text TEXT,
        logo_url VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.tenant_billing_settings: tabla creada`);
  } else {
    log(`· ${schema}.tenant_billing_settings: ya existe`);
  }

  // ── Backfill costs: incurred_at desde month YYYY-MM (día 15) ───────────
  if (await tableExists(s, t, schema, "costs")
      && await columnExists(s, t, schema, "costs", "month")
      && await columnExists(s, t, schema, "costs", "incurred_at")) {
    const [updated] = await s.query(`
      UPDATE "${schema}"."costs"
      SET incurred_at = (month || '-15')::date
      WHERE incurred_at IS NULL AND month ~ '^\\d{4}-(0[1-9]|1[0-2])$'
    `, { transaction: t });
    log(`✓ ${schema}.costs.incurred_at: backfill desde month`);
  }

  // ── Backfill costs: tax_base = amount, total = amount, IVA = 0 ─────────
  // Conservador: facturas históricas se quedan "sin IVA aplicado" para no
  // contaminar el Libro IVA con cálculos inventados.
  if (await tableExists(s, t, schema, "costs")
      && await columnExists(s, t, schema, "costs", "amount")) {
    await s.query(`
      UPDATE "${schema}"."costs"
      SET tax_base = COALESCE(amount, 0),
          total = COALESCE(amount, 0),
          vat_rate = 0,
          tax_amount = 0,
          vat_deductible = FALSE
      WHERE tax_base = 0 AND total = 0 AND amount IS NOT NULL
    `, { transaction: t });
    log(`✓ ${schema}.costs: backfill conservador (vat_rate=0, vat_deductible=false)`);
  }

  // ── Costs.amount: deprecada — pasa a NULL permitido ────────────────────
  if (await tableExists(s, t, schema, "costs")
      && await columnExists(s, t, schema, "costs", "amount")) {
    const [colAmt] = await s.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'costs' AND column_name = 'amount'`,
      { bind: [schema], transaction: t }
    );
    if (colAmt.length > 0 && colAmt[0].is_nullable === "NO") {
      await s.query(
        `ALTER TABLE "${schema}"."costs" ALTER COLUMN amount DROP NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}.costs.amount: NOT NULL eliminado (deprecada)`);
    } else {
      log(`· ${schema}.costs.amount: ya nullable o ausente`);
    }
  }

  // ── Costs.month: deprecada — pasa a NULL permitido ─────────────────────
  // El modelo Sequelize ya no la expone. Mantenemos la columna en BD por
  // compatibilidad con datos históricos. Eliminar en sprint futuro.
  if (await tableExists(s, t, schema, "costs")
      && await columnExists(s, t, schema, "costs", "month")) {
    const [colMonth] = await s.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'costs' AND column_name = 'month'`,
      { bind: [schema], transaction: t }
    );
    if (colMonth.length > 0 && colMonth[0].is_nullable === "NO") {
      await s.query(
        `ALTER TABLE "${schema}"."costs" ALTER COLUMN month DROP NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}.costs.month: NOT NULL eliminado (deprecada)`);
    } else {
      log(`· ${schema}.costs.month: ya nullable o ausente`);
    }
  }

  // ── Backfill costs.incurred_at NOT NULL si todavía hay nulls ───────────
  // (filas sin month válido se backfillean a la fecha de creación)
  if (await tableExists(s, t, schema, "costs")
      && await columnExists(s, t, schema, "costs", "incurred_at")) {
    await s.query(`
      UPDATE "${schema}"."costs"
      SET incurred_at = COALESCE(created_at::date, CURRENT_DATE)
      WHERE incurred_at IS NULL
    `, { transaction: t });
    // Imponer NOT NULL si todavía nullable
    const [colInfo] = await s.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'costs' AND column_name = 'incurred_at'`,
      { bind: [schema], transaction: t }
    );
    if (colInfo.length > 0 && colInfo[0].is_nullable === "YES") {
      await s.query(
        `ALTER TABLE "${schema}"."costs" ALTER COLUMN incurred_at SET NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}.costs.incurred_at: NOT NULL impuesto`);
    }
  }

  // ── Backfill invoices.tax_base = subtotal ──────────────────────────────
  if (await tableExists(s, t, schema, "invoices")
      && await columnExists(s, t, schema, "invoices", "subtotal")
      && await columnExists(s, t, schema, "invoices", "tax_base")) {
    await s.query(`
      UPDATE "${schema}"."invoices"
      SET tax_base = COALESCE(subtotal, 0)
      WHERE tax_base = 0 AND subtotal IS NOT NULL AND subtotal > 0
    `, { transaction: t });
    log(`✓ ${schema}.invoices.tax_base: backfill desde subtotal`);
  }

  // ── Backfill invoices.paid_amount = SUM(payments.amount completed) ─────
  if (await tableExists(s, t, schema, "invoices")
      && await tableExists(s, t, schema, "payments")
      && await columnExists(s, t, schema, "invoices", "paid_amount")) {
    await s.query(`
      UPDATE "${schema}"."invoices" inv
      SET paid_amount = COALESCE((
        SELECT SUM(p.amount)
        FROM "${schema}"."payments" p
        WHERE p.invoice_id = inv.id AND p.status = 'completed'
      ), 0)
    `, { transaction: t });
    log(`✓ ${schema}.invoices.paid_amount: backfill desde payments`);
  }

  // ── Backfill invoices.lines: enriquecer con vatRate por línea ──────────
  // Para facturas existentes, asigna vatRate global a cada línea y rellena
  // lineBase / lineVat / lineTotal a partir de quantity*unitPrice.
  if (await tableExists(s, t, schema, "invoices")
      && await columnExists(s, t, schema, "invoices", "vat_rate")) {
    await s.query(`
      UPDATE "${schema}"."invoices" inv
      SET lines = (
        SELECT jsonb_agg(
          jsonb_build_object(
            'description', COALESCE(line->>'description', ''),
            'quantity',    COALESCE((line->>'quantity')::numeric, 0),
            'unitPrice',   COALESCE((line->>'unitPrice')::numeric, 0),
            'discountPct', COALESCE((line->>'discountPct')::numeric, 0),
            'vatRate',     CASE
                             WHEN line ? 'vatRate' THEN (line->>'vatRate')::numeric
                             ELSE COALESCE(inv.vat_rate, 0)
                           END,
            'lineBase',    ROUND(
                             COALESCE((line->>'quantity')::numeric, 0)
                           * COALESCE((line->>'unitPrice')::numeric, 0)
                           * (1 - COALESCE((line->>'discountPct')::numeric, 0) / 100)
                           , 2),
            'lineVat',     ROUND(
                             COALESCE((line->>'quantity')::numeric, 0)
                           * COALESCE((line->>'unitPrice')::numeric, 0)
                           * (1 - COALESCE((line->>'discountPct')::numeric, 0) / 100)
                           * COALESCE(
                               CASE WHEN line ? 'vatRate' THEN (line->>'vatRate')::numeric ELSE inv.vat_rate END,
                               0
                             ) / 100
                           , 2),
            'lineTotal',   ROUND(
                             COALESCE((line->>'quantity')::numeric, 0)
                           * COALESCE((line->>'unitPrice')::numeric, 0)
                           * (1 - COALESCE((line->>'discountPct')::numeric, 0) / 100)
                           * (1 + COALESCE(
                               CASE WHEN line ? 'vatRate' THEN (line->>'vatRate')::numeric ELSE inv.vat_rate END,
                               0
                             ) / 100)
                           , 2)
          )
        )
        FROM jsonb_array_elements(inv.lines) AS line
      )
      WHERE jsonb_typeof(inv.lines) = 'array'
        AND jsonb_array_length(inv.lines) > 0
        AND NOT (inv.lines @> '[{"lineTotal":0}]'::jsonb AND inv.lines @> '[{"vatRate":0}]'::jsonb)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(inv.lines) l
          WHERE l ? 'lineBase' AND l ? 'lineVat' AND l ? 'lineTotal'
        )
    `, { transaction: t });
    log(`✓ ${schema}.invoices.lines: enriquecidas con vatRate por línea`);
  }

  // ── Crear series 'F' y 'R' por defecto ─────────────────────────────────
  const currentYear = new Date().getFullYear();
  if (await tableExists(s, t, schema, "invoice_series")) {
    // Detectar el siguiente número desde facturas ya existentes (si las hay)
    const [maxRows] = await s.query(`
      SELECT COALESCE(MAX(
        CASE
          WHEN number ~ ('^F-' || $1 || '-[0-9]+$')
          THEN (regexp_replace(number, '^F-' || $1 || '-', ''))::int
          ELSE 0
        END
      ), 0) AS max_n
      FROM "${schema}"."invoices"
    `, { bind: [String(currentYear)], transaction: t });
    const nextNumberF = (Number(maxRows[0]?.max_n) || 0) + 1;

    await s.query(`
      INSERT INTO "${schema}"."invoice_series" (code, name, prefix, year, next_number, is_default, kind)
      SELECT 'F', 'Facturas ordinarias', 'F', $1, $2, TRUE, 'normal'
      WHERE NOT EXISTS (SELECT 1 FROM "${schema}"."invoice_series" WHERE code = 'F')
    `, { bind: [currentYear, nextNumberF], transaction: t });

    await s.query(`
      INSERT INTO "${schema}"."invoice_series" (code, name, prefix, year, next_number, is_default, kind)
      SELECT 'R', 'Rectificativas', 'R', $1, 1, FALSE, 'rectificative'
      WHERE NOT EXISTS (SELECT 1 FROM "${schema}"."invoice_series" WHERE code = 'R')
    `, { bind: [currentYear], transaction: t });
    log(`✓ ${schema}.invoice_series: 'F' (next=${nextNumberF}) y 'R' aseguradas`);
  }

  // ── Crear settings por defecto si no existen ───────────────────────────
  if (await tableExists(s, t, schema, "tenant_billing_settings")) {
    await s.query(`
      INSERT INTO "${schema}"."tenant_billing_settings" (default_vat_rate, available_vat_rates, default_payment_terms_days)
      SELECT 21, '[21,10,4,0]'::jsonb, 30
      WHERE NOT EXISTS (SELECT 1 FROM "${schema}"."tenant_billing_settings")
    `, { transaction: t });
    log(`✓ ${schema}.tenant_billing_settings: fila por defecto asegurada`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function fetchActiveSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`
  );
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: rework billing (multi-tenant)            \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    const [versionRows] = await sequelize.query("SHOW server_version");
    log(`PostgreSQL: ${versionRows[0]?.server_version ?? "?"}`);

    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchActiveSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    // Fase A: ALTER TYPE en autocommit (cada slug por separado)
    header("Fase A — ALTER TYPE de enums (autocommit)...");
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      await alterEnums(sequelize, schema);
    }

    // Fase B: ADD COLUMN, CREATE TABLE, backfill (en transacción global)
    header("Fase B — ADD COLUMN, CREATE TABLE y backfill (transacción global)...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        await processSchemaInTx(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración billing rework completada                \n");
    process.stdout.write("════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
