/**
 * migrate-suppliers.js — proveedores como entidad, no como texto suelto.
 *
 * Crea `suppliers` y añade `costs.supplier_id`. Sale de la revisión del
 * 02/08/2026 (Rodrigo): los proveedores estaban en dos sitios y ninguno servía —
 * en Gastos no existían, y en Inventario eran un campo de TEXTO LIBRE
 * (`inbound_batches.supplier`), así que el mismo proveedor se reescribía en cada
 * entrega.
 *
 * Esta migración NO toca `inbound_batches`: de eso se encarga el sprint 8c, que
 * rehace Inventario entero. Aquí solo se crea la entidad y el enlace desde
 * Gastos, que es lo que se puede hacer sin depender de ese rediseño.
 *
 * FK ON DELETE SET NULL: si se borra un proveedor, el gasto NO desaparece — es
 * un apunte contable. Se queda sin proveedor asociado.
 *
 * Aditiva e idempotente. No-op en schemas sin `costs`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-suppliers.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-suppliers.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}
async function constraintExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.conname=$2`,
    { bind: [schema, name] }
  );
  return rows.length > 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

/**
 * Añade una FK y, si el schema no la admite, sigue avisando.
 *
 * Solo se traga el error de "tabla referenciada sin restricción única" (42830),
 * que es el de los schemas-foto tipo `crm_demo_golden`, hechos copiando tablas
 * sin clave primaria. Cualquier otro error se propaga: esconderlo sería peor.
 */
async function intentarFk(s, schema, nombre, sql) {
  try {
    await s.query(sql);
  } catch (err) {
    const msg = err?.parent?.message ?? err?.message ?? "";
    if (err?.parent?.code === "42830" || /no unique constraint matching/i.test(msg)) {
      log(`⚠ ${schema}: sin FK ${nombre} (tabla referenciada sin clave primaria; schema de copia)`);
      return;
    }
    throw err;
  }
}

async function processSchema(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "costs"))) {
    log(`· ${schema}: sin gastos (no tiene facturación), se salta`);
    return;
  }

  const pk = uuidDefault ? "DEFAULT gen_random_uuid()" : "";

  if (!(await tableExists(s, schema, "suppliers"))) {
    await s.query(`
      CREATE TABLE "${schema}"."suppliers" (
        id           UUID PRIMARY KEY ${pk},
        name         VARCHAR(200) NOT NULL,
        tax_id       VARCHAR(30),
        email        VARCHAR(255),
        phone        VARCHAR(50),
        contact_name VARCHAR(200),
        address      VARCHAR(255),
        notes        TEXT,
        active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla suppliers creada`);
  } else {
    log(`· ${schema}: suppliers ya existía`);
  }

  await s.query(`CREATE INDEX IF NOT EXISTS "suppliers_name_idx"   ON "${schema}"."suppliers" (name)`);
  await s.query(`CREATE INDEX IF NOT EXISTS "suppliers_active_idx" ON "${schema}"."suppliers" (active)`);

  if (!(await columnExists(s, schema, "costs", "supplier_id"))) {
    await s.query(`ALTER TABLE "${schema}"."costs" ADD COLUMN supplier_id UUID`);
    log(`✓ ${schema}: costs.supplier_id añadida`);
  }

  if (!(await constraintExists(s, schema, "costs_supplier_fk"))) {
    // SET NULL: borrar un proveedor no puede llevarse por delante un apunte
    // contable. El gasto se queda, sin proveedor.
    await intentarFk(s, schema, "costs_supplier_fk", `
      ALTER TABLE "${schema}"."costs"
        ADD CONSTRAINT costs_supplier_fk
        FOREIGN KEY (supplier_id) REFERENCES "${schema}"."suppliers"(id) ON DELETE SET NULL
    `);
  }

  await s.query(`CREATE INDEX IF NOT EXISTS "costs_supplier_idx" ON "${schema}"."costs" (supplier_id)`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Proveedores · ${schemas.length} schema(s)\n\n`);
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
