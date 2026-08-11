/**
 * migrate-impuestos-y-arqueo.js — dos cambios universales (02/08/2026).
 *
 * Los dos salen de revisar la migración de Aumenta con Rodrigo, y los dos
 * aplican a TODOS los clientes, no solo a ellos.
 *
 * ── 1. Categoría de IMPUESTOS en los gastos ────────────────────────────────
 *
 * `costs.type` no tenía dónde meter IRPF, IVA, IBI ni tasas: acababan en
 * «otros», mezclados con la compra de folios. Solo en Aumenta son 88 gastos.
 * Cualquier negocio paga impuestos, así que la categoría va al enum de todos.
 *
 * ── 2. Arqueo VARIAS VECES al día ──────────────────────────────────────────
 *
 * `cash_closes` tenía un índice único (caja, día): un cierre diario. Al importar
 * Aumenta se vio que cierran la caja varias veces al día —cada fila lleva su
 * hora— y Rodrigo confirma que quiere seguir haciéndolo. El único se sustituye
 * por un índice normal.
 *
 * La hora ya la guarda `closed_at`; lo único que hacía falta era dejar de
 * prohibir el segundo cierre del día.
 *
 * Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-impuestos-y-arqueo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-impuestos-y-arqueo.js
 */

import { Sequelize } from "sequelize";

import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  // ── 1. 'tax' en el enum de costs.type ───────────────────────────────────
  if (await tableExists(s, schema, "costs")) {
    // El tipo ENUM lo crea Sequelize con el nombre enum_<tabla>_<columna> y
    // vive DENTRO del schema del tenant, así que hay uno por cliente.
    const [tipos] = await s.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname=$1 AND t.typname='enum_costs_type'`,
      { bind: [schema] }
    );
    if (tipos.length) {
      const [ya] = await s.query(
        `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname=$1 AND t.typname='enum_costs_type' AND e.enumlabel='tax'`,
        { bind: [schema] }
      );
      if (ya.length) {
        log(`· ${schema}: costs.type ya admite 'tax'`);
      } else {
        // ADD VALUE no se puede ejecutar dentro de una transacción en algunas
        // versiones de Postgres, por eso esta migración no abre ninguna.
        await s.query(`ALTER TYPE "${schema}"."enum_costs_type" ADD VALUE IF NOT EXISTS 'tax'`);
        log(`✓ ${schema}: 'tax' añadido a costs.type`);
      }
    } else {
      log(`⚠ ${schema}: costs.type no es un enum aquí, se salta`);
    }
  }

  // ── 2. Arqueo varias veces al día ───────────────────────────────────────
  if (await tableExists(s, schema, "cash_closes")) {
    const [idx] = await s.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='cash_closes'
         AND indexname='cash_closes_point_date_unique'`,
      { bind: [schema] }
    );
    if (idx.length) {
      await s.query(`DROP INDEX "${schema}"."cash_closes_point_date_unique"`);
      // Se sustituye por uno NORMAL: sigue haciendo falta para buscar los
      // cierres de una caja en un rango de fechas, solo deja de ser único.
      await s.query(
        `CREATE INDEX IF NOT EXISTS "cash_closes_point_date_idx"
           ON "${schema}"."cash_closes" (cash_point_id, close_date)`
      );
      log(`✓ ${schema}: la caja ya se puede arquear varias veces al día`);
    } else {
      log(`· ${schema}: el arqueo ya admitía varios al día`);
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Impuestos y arqueo · ${schemas.length} schema(s)\n\n`);
    for (const schema of schemas) await processSchema(s, schema);
    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
