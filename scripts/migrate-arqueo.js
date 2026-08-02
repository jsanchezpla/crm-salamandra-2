/**
 * migrate-arqueo.js — arqueo de caja: puntos de cobro y cierres diarios.
 *
 * Sale de la revisión del 02/08/2026: se comparó nuestro módulo de Facturación
 * con Contabilidad de Organízate y lo único que faltaba era el ARQUEO, que allí
 * ocupa tres secciones (`cajas`, `arqueo`, `cierres`). En la extracción de
 * Aumenta hay **778 cierres históricos** con su columna de descuadre, así que no
 * es una función teórica: es lo que llevan haciendo cada día.
 *
 * `difference` se guarda calculado en vez de recalcularse al leer: un cierre es
 * la FOTO de lo que se contó ese día. Si mañana se corrige un cobro antiguo, el
 * arqueo de hace un mes NO puede cambiar de resultado solo.
 *
 * Índice único (cash_point_id, close_date): cerrar dos veces la misma caja el
 * mismo día dejaría dos verdades distintas.
 *
 * Aditiva e idempotente. No-op en schemas sin `costs` (sin facturación).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-arqueo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-arqueo.js
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
 * Solo se traga el error 42830 ("tabla referenciada sin restricción única"), que
 * es el de los schemas-foto tipo `crm_demo_golden`, copiados sin clave primaria.
 * Cualquier otro error se propaga: esconderlo dejaría una migración a medias sin
 * que nadie se enterara (pasó el 02/08 con migrate-external-contacts).
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
    log(`· ${schema}: sin facturación, se salta`);
    return;
  }

  const pk = uuidDefault ? "DEFAULT gen_random_uuid()" : "";

  if (!(await tableExists(s, schema, "cash_points"))) {
    await s.query(`
      CREATE TABLE "${schema}"."cash_points" (
        id         UUID PRIMARY KEY ${pk},
        name       VARCHAR(120) NOT NULL,
        active     BOOLEAN NOT NULL DEFAULT TRUE,
        notes      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla cash_points creada`);
  } else {
    log(`· ${schema}: cash_points ya existía`);
  }
  await s.query(`CREATE INDEX IF NOT EXISTS "cash_points_active_idx" ON "${schema}"."cash_points" (active)`);

  if (!(await tableExists(s, schema, "cash_closes"))) {
    await s.query(`
      CREATE TABLE "${schema}"."cash_closes" (
        id              UUID PRIMARY KEY ${pk},
        cash_point_id   UUID NOT NULL,
        close_date      DATE NOT NULL,
        opening_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
        expected_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        counted_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
        difference      NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes           TEXT,
        closed_by_id    UUID,
        closed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla cash_closes creada`);
  } else {
    log(`· ${schema}: cash_closes ya existía`);
  }

  // Un solo cierre por caja y día.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "cash_closes_point_date_unique" ON "${schema}"."cash_closes" (cash_point_id, close_date)`
  );
  await s.query(`CREATE INDEX IF NOT EXISTS "cash_closes_date_idx" ON "${schema}"."cash_closes" (close_date)`);

  if (!(await constraintExists(s, schema, "cash_closes_point_fk"))) {
    // RESTRICT: borrar una caja con cierres se lleva por delante el histórico
    // contable. Para eso está `active = false`.
    await intentarFk(s, schema, "cash_closes_point_fk", `
      ALTER TABLE "${schema}"."cash_closes"
        ADD CONSTRAINT cash_closes_point_fk
        FOREIGN KEY (cash_point_id) REFERENCES "${schema}"."cash_points"(id) ON DELETE RESTRICT
    `);
  }

  if (await tableExists(s, schema, "team_members")) {
    if (!(await constraintExists(s, schema, "cash_closes_closed_by_fk"))) {
      // SET NULL: si alguien deja el centro, sus cierres siguen existiendo.
      await intentarFk(s, schema, "cash_closes_closed_by_fk", `
        ALTER TABLE "${schema}"."cash_closes"
          ADD CONSTRAINT cash_closes_closed_by_fk
          FOREIGN KEY (closed_by_id) REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL
      `);
    }
  } else {
    log(`· ${schema}: sin team_members, closed_by_id queda sin FK`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const uuidDefault = await ensureUuidFn(s);
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Arqueo de caja · ${schemas.length} schema(s)\n\n`);
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
