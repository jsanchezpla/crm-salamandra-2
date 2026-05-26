/**
 * migrate-citas-sprint-1.js
 *
 * Sprint 1 del módulo Citas (#nuevo).
 *
 * Cambios:
 *   - CREATE TYPE enum_bookings_modality, enum_bookings_status
 *   - CREATE TABLE event_types, availabilities, bookings
 *
 * Estrategia:
 *   - Fase A en autocommit: CREATE TYPE de enums (Postgres no permite ADD
 *     VALUE en la misma transacción; aquí solo creamos enums nuevos, no
 *     hacemos ADD VALUE, pero mantenemos la estructura del patrón).
 *   - Fase B en transacción global: CREATE TABLE IF NOT EXISTS de las 3
 *     tablas + índices + FKs.
 *   - Idempotente. Lee slugs activos desde master.tenants.
 *   - NO inserta filas TenantModule(moduleKey='citas'). Activación manual.
 *
 * Uso:
 *   npm run db:migrate:citas         (local)
 *   npm run db:migrate:citas:prod    (producción)
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

async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName], transaction: t }
  );
  return rows.length > 0;
}

async function enumTypeExists(s, t, enumTypeName, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp
     JOIN pg_namespace n ON n.oid = tp.typnamespace
     WHERE tp.typname = $1 AND n.nspname = $2`,
    { bind: [enumTypeName, schema], transaction: t ?? undefined }
  );
  return rows.length > 0;
}

// ─── Fase A: CREATE TYPE en autocommit ─────────────────────────────────────

async function createEnumsAutocommit(s, schema) {
  if (!(await enumTypeExists(s, null, "enum_bookings_modality", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_bookings_modality" AS ENUM ('presencial', 'phone', 'online')`
    );
    log(`✓ ${schema} enum enum_bookings_modality: creado`);
  } else {
    log(`· ${schema} enum enum_bookings_modality: ya existe`);
  }

  if (!(await enumTypeExists(s, null, "enum_bookings_status", schema))) {
    await s.query(
      `CREATE TYPE "${schema}"."enum_bookings_status" AS ENUM ('confirmed', 'completed', 'cancelled', 'no_show')`
    );
    log(`✓ ${schema} enum enum_bookings_status: creado`);
  } else {
    log(`· ${schema} enum enum_bookings_status: ya existe`);
  }
}

// ─── Fase B: CREATE TABLE en transacción ───────────────────────────────────

async function processSchemaInTx(s, t, schema) {
  // ── event_types ────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "event_types"))) {
    await s.query(`
      CREATE TABLE "${schema}"."event_types" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        slug VARCHAR(255) NOT NULL,
        duration INTEGER NOT NULL,
        buffer_before INTEGER NOT NULL DEFAULT 0,
        buffer_after INTEGER NOT NULL DEFAULT 0,
        color VARCHAR(7),
        modalities JSONB NOT NULL DEFAULT '["online"]'::jsonb,
        location VARCHAR(255),
        phone_number VARCHAR(255),
        meet_url VARCHAR(255),
        additional_data_label VARCHAR(255),
        additional_data_required BOOLEAN NOT NULL DEFAULT FALSE,
        min_notice_hours INTEGER NOT NULL DEFAULT 24,
        max_advance_days INTEGER NOT NULL DEFAULT 60,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.event_types: tabla creada`);
  } else {
    log(`· ${schema}.event_types: ya existe`);
  }

  if (await tableExists(s, t, schema, "event_types")) {
    if (!(await indexExists(s, t, schema, "event_types_slug_unique"))) {
      await s.query(
        `CREATE UNIQUE INDEX "event_types_slug_unique" ON "${schema}"."event_types" (slug)`,
        { transaction: t }
      );
      log(`✓ ${schema} index event_types_slug_unique: creado`);
    } else {
      log(`· ${schema} index event_types_slug_unique: ya existe`);
    }

    if (!(await indexExists(s, t, schema, "event_types_active_order_idx"))) {
      await s.query(
        `CREATE INDEX "event_types_active_order_idx" ON "${schema}"."event_types" (active, "order")`,
        { transaction: t }
      );
      log(`✓ ${schema} index event_types_active_order_idx: creado`);
    } else {
      log(`· ${schema} index event_types_active_order_idx: ya existe`);
    }
  }

  // ── availabilities ─────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "availabilities"))) {
    await s.query(`
      CREATE TABLE "${schema}"."availabilities" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type_id UUID REFERENCES "${schema}"."event_types"(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.availabilities: tabla creada`);
  } else {
    log(`· ${schema}.availabilities: ya existe`);
  }

  if (await tableExists(s, t, schema, "availabilities")) {
    if (!(await indexExists(s, t, schema, "availabilities_event_type_day_idx"))) {
      await s.query(
        `CREATE INDEX "availabilities_event_type_day_idx" ON "${schema}"."availabilities" (event_type_id, day_of_week)`,
        { transaction: t }
      );
      log(`✓ ${schema} index availabilities_event_type_day_idx: creado`);
    } else {
      log(`· ${schema} index availabilities_event_type_day_idx: ya existe`);
    }
  }

  // ── bookings ───────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "bookings"))) {
    await s.query(`
      CREATE TABLE "${schema}"."bookings" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type_id UUID NOT NULL REFERENCES "${schema}"."event_types"(id) ON DELETE RESTRICT,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        client_phone VARCHAR(255) NOT NULL,
        additional_data TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration INTEGER NOT NULL,
        modality "${schema}"."enum_bookings_modality" NOT NULL,
        meet_url VARCHAR(255),
        status "${schema}"."enum_bookings_status" NOT NULL DEFAULT 'confirmed',
        cancellation_token UUID NOT NULL DEFAULT gen_random_uuid(),
        cancelled_at TIMESTAMPTZ,
        cancellation_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });
    log(`✓ ${schema}.bookings: tabla creada`);
  } else {
    log(`· ${schema}.bookings: ya existe`);
  }

  if (await tableExists(s, t, schema, "bookings")) {
    if (!(await indexExists(s, t, schema, "bookings_scheduled_status_idx"))) {
      await s.query(
        `CREATE INDEX "bookings_scheduled_status_idx" ON "${schema}"."bookings" (scheduled_at, status)`,
        { transaction: t }
      );
      log(`✓ ${schema} index bookings_scheduled_status_idx: creado`);
    } else {
      log(`· ${schema} index bookings_scheduled_status_idx: ya existe`);
    }

    if (!(await indexExists(s, t, schema, "bookings_client_email_idx"))) {
      await s.query(
        `CREATE INDEX "bookings_client_email_idx" ON "${schema}"."bookings" (client_email)`,
        { transaction: t }
      );
      log(`✓ ${schema} index bookings_client_email_idx: creado`);
    } else {
      log(`· ${schema} index bookings_client_email_idx: ya existe`);
    }
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
  process.stdout.write(" Migración: Citas Sprint 1 (multi-tenant)            \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

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

    header("Fase A — CREATE TYPE de enums (autocommit)...");
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      await createEnumsAutocommit(sequelize, schema);
    }

    header("Fase B — CREATE TABLE + índices (transacción global)...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        process.stdout.write(`\n· Schema ${schema}\n`);
        await processSchemaInTx(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    process.stdout.write(" ℹ La migración solo crea tablas. Para activar el   \n");
    process.stdout.write("   módulo en un tenant: insertar/actualizar fila en \n");
    process.stdout.write("   master.tenant_modules con moduleKey='citas' y    \n");
    process.stdout.write("   enabled=true. Sin esa fila, el módulo no aparece.\n");
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
