/**
 * migrate-billing-fix-kind-enum.js
 *
 * Sub-migración correctiva del bug histórico en migrate-billing-rework.js:
 * la columna `invoice_series.kind` se creó como VARCHAR(20) en lugar de
 * usar el ENUM enum_invoice_series_kind que el modelo Sequelize espera.
 * Cualquier `sync({ alter: true })` posterior peta al intentar convertir
 * VARCHAR → ENUM con un default 'normal' incompatible.
 *
 * El bug ya está corregido en migrate-billing-rework.js (la columna se crea
 * como ENUM directamente). Este script corrige los tenants donde la
 * migración antigua ya dejó la columna como VARCHAR.
 *
 * Idempotente:
 *   - Si la tabla invoice_series no existe, salta (módulo billing inactivo).
 *   - Si el ENUM ya existe, salta su creación.
 *   - Si la columna kind ya es ENUM, no toca nada.
 *   - Si es VARCHAR, drop default → ALTER TYPE → set default.
 *
 * Lee slugs desde master.tenants (regla 12 de CLAUDE.md). NUNCA hardcodea.
 *
 * Uso:
 *   npm run db:migrate:billing-fix-kind-enum         (local)
 *   npm run db:migrate:billing-fix-kind-enum:prod    (producción)
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] },
  );
  return rows.length > 0;
}

async function enumTypeExists(s, schema, enumTypeName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND n.nspname = $2`,
    { bind: [enumTypeName, schema] },
  );
  return rows.length > 0;
}

async function getColumnType(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] },
  );
  return rows[0] ?? null;
}

async function fixSchema(s, schema) {
  if (!(await tableExists(s, schema, "invoice_series"))) {
    return { schema, action: "skipped", reason: "tabla invoice_series no existe (módulo billing inactivo)" };
  }

  const col = await getColumnType(s, schema, "invoice_series", "kind");
  if (!col) {
    return { schema, action: "skipped", reason: "columna kind no existe" };
  }

  // Si ya es USER-DEFINED y udt_name = enum_invoice_series_kind, nada que hacer.
  if (col.data_type === "USER-DEFINED" && col.udt_name === "enum_invoice_series_kind") {
    return { schema, action: "already-migrated", reason: "kind ya es ENUM" };
  }

  // Asegurar que existe el ENUM antes de la conversión.
  if (!(await enumTypeExists(s, schema, "enum_invoice_series_kind"))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_invoice_series_kind" AS ENUM ('normal', 'rectificative')`,
    );
    log(`  · ${schema}: enum enum_invoice_series_kind creado`);
  }

  // Verificar que los valores actuales caben en el ENUM (sanity check).
  const [badRows] = await s.query(
    `SELECT DISTINCT kind FROM "${schema}"."invoice_series"
     WHERE kind NOT IN ('normal', 'rectificative')`,
  );
  if (badRows.length > 0) {
    const found = badRows.map((r) => r.kind).join(", ");
    throw new Error(
      `${schema}.invoice_series.kind contiene valores no convertibles a ENUM: ${found}`,
    );
  }

  // Drop default → ALTER TYPE → set default.
  await s.query(
    `ALTER TABLE "${schema}"."invoice_series" ALTER COLUMN "kind" DROP DEFAULT`,
  );
  await s.query(
    `ALTER TABLE "${schema}"."invoice_series"
     ALTER COLUMN "kind" TYPE "${schema}"."enum_invoice_series_kind"
     USING "kind"::"${schema}"."enum_invoice_series_kind"`,
  );
  await s.query(
    `ALTER TABLE "${schema}"."invoice_series" ALTER COLUMN "kind" SET DEFAULT 'normal'`,
  );

  return { schema, action: "migrated", reason: `kind convertida de ${col.data_type} a ENUM` };
}

async function fetchActiveSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`,
  );
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración correctiva: invoice_series.kind ENUM     \n");
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

    header("Procesando cada schema...");
    const results = [];
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      try {
        const r = await fixSchema(sequelize, schema);
        results.push(r);
        const icon = r.action === "migrated" ? "✓" : "·";
        log(`${icon} ${schema}: ${r.action} — ${r.reason}`);
      } catch (err) {
        results.push({ schema, action: "error", reason: err.message });
        log(`✗ ${schema}: error — ${err.message}`);
      }
    }

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" Resumen                                            \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    const counts = {
      migrated: results.filter((r) => r.action === "migrated").length,
      "already-migrated": results.filter((r) => r.action === "already-migrated").length,
      skipped: results.filter((r) => r.action === "skipped").length,
      error: results.filter((r) => r.action === "error").length,
    };
    log(`migrados:        ${counts.migrated}`);
    log(`ya migrados:     ${counts["already-migrated"]}`);
    log(`saltados:        ${counts.skipped}`);
    log(`errores:         ${counts.error}`);
    process.stdout.write("\n");

    await sequelize.close();
    process.exit(counts.error > 0 ? 1 : 0);
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
