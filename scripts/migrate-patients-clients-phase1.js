/**
 * migrate-patients-clients-phase1.js — Sprint "Pacientes & Clientes" (Fase 1a).
 *
 * Para CADA tenant activo (lista de master.tenants en runtime — regla #12), de
 * forma condicional según qué tablas existan en su schema (tolerante a schema
 * parcial), y todo ADITIVO (nada destructivo):
 *
 *   Si existe `clients`:
 *     - CREATE TABLE client_contact_methods (emails/teléfonos múltiples
 *       etiquetados, uno principal por tipo) con FK → clients CASCADE.
 *     - ADD COLUMN clients.separated (BOOLEAN, tutores separados).
 *     - BACKFILL: crea un método principal a partir de clients.email / .phone
 *       existentes (idempotente).
 *   Si existe `patients`:
 *     - ADD COLUMN patients.dni, address, relationship, consents(JSONB),
 *       contract_signed(bool), contract_file(JSONB).
 *   Si existe `bookings`:
 *     - ADD COLUMN bookings.patient_id (+ índice) y, si existe `patients`,
 *       FK → patients(id) ON DELETE SET NULL.
 *
 * Idempotente (IF NOT EXISTS / checks). Transacción por-tenant. Un fallo en un
 * tenant no aborta el resto.
 *
 * ⚠️ ORDEN DE DEPLOY: los nuevos modelos hacen que TODA lectura de
 * Client/Patient/Booking seleccione las columnas nuevas → 42703 si la app nueva
 * se despliega ANTES de migrar. Como el script es nuevo y el contenedor viejo
 * no lo tiene, en el VPS: `git pull` → `docker cp scripts/migrate-patients-clients-phase1.js
 * crm-salamandra-app-1:/app/scripts/` → `docker exec crm-salamandra-app-1 node
 * scripts/migrate-patients-clients-phase1.js` → `./deploy.sh`. Así se migra ANTES
 * del deploy y no hay ventana de 42703.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-patients-clients-phase1.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Introspección ──────────────────────────────────────────────────────────
async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}
async function constraintExists(s, t, schema, table, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.table_constraints WHERE table_schema = $1 AND table_name = $2 AND constraint_name = $3`,
    { bind: [schema, table, name], transaction: t }
  );
  return rows.length > 0;
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`SELECT slug FROM master.tenants ORDER BY slug`);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribio. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

// ─── Migración por schema ────────────────────────────────────────────────────
async function migrateSchema(s, schema) {
  await s.transaction(async (t) => {
    // ── A) client_contact_methods + clients.separated + backfill ──────────────
    if (await tableExists(s, t, schema, "clients")) {
      // Tipo ENUM (idempotente).
      await s.query(
        `DO $do$ BEGIN
           CREATE TYPE "${schema}".enum_client_contact_methods_kind AS ENUM ('email','phone');
         EXCEPTION WHEN duplicate_object THEN NULL; END $do$;`,
        { transaction: t }
      );
      if (!(await tableExists(s, t, schema, "client_contact_methods"))) {
        await s.query(
          `CREATE TABLE "${schema}".client_contact_methods (
             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             client_id UUID NOT NULL REFERENCES "${schema}".clients(id) ON DELETE CASCADE,
             kind "${schema}".enum_client_contact_methods_kind NOT NULL,
             value VARCHAR(255) NOT NULL,
             label VARCHAR(60),
             is_primary BOOLEAN NOT NULL DEFAULT false,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )`,
          { transaction: t }
        );
        log(`✓ ${schema}.client_contact_methods: tabla creada`);
      }
      // Idempotente: si la tabla ya existía con value VARCHAR(180), ensánchala a
      // 255 (paridad con Client.email/phone). ALTER TYPE a un tipo más ancho no
      // reescribe la tabla y es no-op si ya es 255.
      await s.query(
        `ALTER TABLE "${schema}".client_contact_methods ALTER COLUMN value TYPE VARCHAR(255)`,
        { transaction: t }
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS client_contact_methods_client_idx ON "${schema}".client_contact_methods(client_id)`,
        { transaction: t }
      );
      await s.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS client_contact_methods_primary_uq ON "${schema}".client_contact_methods(client_id, kind) WHERE is_primary`,
        { transaction: t }
      );
      await s.query(
        `ALTER TABLE "${schema}".clients ADD COLUMN IF NOT EXISTS separated BOOLEAN`,
        { transaction: t }
      );
      // Backfill del principal desde email/phone existentes (idempotente).
      const [emailRes] = await s.query(
        `INSERT INTO "${schema}".client_contact_methods (id, client_id, kind, value, is_primary, created_at, updated_at)
         SELECT gen_random_uuid(), c.id, 'email', c.email, true, now(), now()
         FROM "${schema}".clients c
         WHERE c.email IS NOT NULL AND c.email <> ''
           AND NOT EXISTS (SELECT 1 FROM "${schema}".client_contact_methods m WHERE m.client_id = c.id AND m.kind = 'email')`,
        { transaction: t }
      );
      const [phoneRes] = await s.query(
        `INSERT INTO "${schema}".client_contact_methods (id, client_id, kind, value, is_primary, created_at, updated_at)
         SELECT gen_random_uuid(), c.id, 'phone', c.phone, true, now(), now()
         FROM "${schema}".clients c
         WHERE c.phone IS NOT NULL AND c.phone <> ''
           AND NOT EXISTS (SELECT 1 FROM "${schema}".client_contact_methods m WHERE m.client_id = c.id AND m.kind = 'phone')`,
        { transaction: t }
      );
      log(`✓ ${schema}.clients: separated + backfill (${emailRes?.rowCount ?? 0} emails, ${phoneRes?.rowCount ?? 0} teléfonos)`);
    }

    // ── B) columnas nuevas de patients ────────────────────────────────────────
    if (await tableExists(s, t, schema, "patients")) {
      await s.query(
        `ALTER TABLE "${schema}".patients
           ADD COLUMN IF NOT EXISTS dni VARCHAR(20),
           ADD COLUMN IF NOT EXISTS address VARCHAR(255),
           ADD COLUMN IF NOT EXISTS relationship VARCHAR(60),
           ADD COLUMN IF NOT EXISTS consents JSONB NOT NULL DEFAULT '{}'::jsonb,
           ADD COLUMN IF NOT EXISTS contract_signed BOOLEAN NOT NULL DEFAULT false,
           ADD COLUMN IF NOT EXISTS contract_file JSONB`,
        { transaction: t }
      );
      log(`✓ ${schema}.patients: columnas dni/address/relationship/consents/contract listas`);
    }

    // ── C) bookings.patient_id (+ índice + FK si hay patients) ─────────────────
    if (await tableExists(s, t, schema, "bookings")) {
      await s.query(`ALTER TABLE "${schema}".bookings ADD COLUMN IF NOT EXISTS patient_id UUID`, { transaction: t });
      await s.query(
        `CREATE INDEX IF NOT EXISTS bookings_patient_idx ON "${schema}".bookings(patient_id)`,
        { transaction: t }
      );
      if ((await tableExists(s, t, schema, "patients")) && !(await constraintExists(s, t, schema, "bookings", "bookings_patient_id_fkey"))) {
        await s.query(
          `ALTER TABLE "${schema}".bookings
             ADD CONSTRAINT bookings_patient_id_fkey FOREIGN KEY (patient_id)
             REFERENCES "${schema}".patients(id) ON DELETE SET NULL`,
          { transaction: t }
        );
      }
      log(`✓ ${schema}.bookings: patient_id listo`);
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Pacientes & Clientes — Fase 1a\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  header(`Tenants activos: ${slugs.length} (${slugs.join(", ")})`);

  let okCount = 0;
  let errCount = 0;
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    if (!/^crm_[a-z0-9_]+$/.test(schema)) { log(`· ${schema}: slug inválido — se omite`); continue; }
    if (!(await schemaExists(sequelize, schema))) { log(`· ${schema}: schema inexistente — se omite`); continue; }
    try {
      await migrateSchema(sequelize, schema);
      okCount++;
    } catch (err) {
      errCount++;
      process.stderr.write(`  ✗ ${schema}: ${err.message}\n`);
    }
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` ✓ Migración completada (${okCount} OK, ${errCount} con error)\n`);
  process.stdout.write("════════════════════════════════════════════════════\n\n");
  await sequelize.close();
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error fatal: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
