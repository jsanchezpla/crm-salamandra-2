/**
 * migrate-external-contacts.js — agenda de profesionales EXTERNOS por paciente.
 *
 * Crea `external_contacts` y añade `coordinations.external_contact_id`, para que
 * un acta de coordinación apunte a una persona de verdad en vez de a un nombre
 * reescrito a mano en cada reunión (Rodrigo, 02/08/2026).
 *
 * De dónde sale: al migrar Aumenta aparecieron la orientadora del instituto, la
 * PT del aula TEA o la tutora del cole metidas en las ranuras de «tutor» de
 * Organízate — el síntoma clásico de que falta un sitio donde ponerlas.
 *
 * FKs con ON DELETE: CASCADE desde el paciente (si se borra el paciente, su
 * agenda no tiene sentido) y SET NULL desde la coordinación (si se borra el
 * contacto, el acta NO se borra: es un documento clínico).
 *
 * Aditiva e idempotente. No-op en schemas sin `patients` (tenant sin clínica).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-external-contacts.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-external-contacts.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  return rows.map((r) => r.schema_name);
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
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

async function processSchema(s, schema, uuidDefault) {
  if (!(await tableExists(s, schema, "patients"))) {
    log(`· ${schema}: sin pacientes (no tiene el módulo clínico), se salta`);
    return;
  }

  const pk = uuidDefault ? "DEFAULT gen_random_uuid()" : "";

  if (!(await tableExists(s, schema, "external_contacts"))) {
    await s.query(`
      CREATE TABLE "${schema}"."external_contacts" (
        id          UUID PRIMARY KEY ${pk},
        patient_id  UUID NOT NULL,
        client_id   UUID,
        name        VARCHAR(200) NOT NULL,
        role        VARCHAR(200),
        email       VARCHAR(255),
        phone       VARCHAR(50),
        entity      VARCHAR(200),
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla external_contacts creada`);

    // Si se borra el paciente, su agenda de externos deja de tener sentido.
    await s.query(`
      ALTER TABLE "${schema}"."external_contacts"
        ADD CONSTRAINT external_contacts_patient_fk
        FOREIGN KEY (patient_id) REFERENCES "${schema}"."patients"(id) ON DELETE CASCADE
    `);
    if (await tableExists(s, schema, "clients")) {
      await s.query(`
        ALTER TABLE "${schema}"."external_contacts"
          ADD CONSTRAINT external_contacts_client_fk
          FOREIGN KEY (client_id) REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL
      `);
    }
  } else {
    log(`· ${schema}: external_contacts ya existía`);
  }

  await s.query(`CREATE INDEX IF NOT EXISTS "external_contacts_patient_idx" ON "${schema}"."external_contacts" (patient_id)`);
  await s.query(`CREATE INDEX IF NOT EXISTS "external_contacts_client_idx"  ON "${schema}"."external_contacts" (client_id)`);

  // ── El enlace desde el acta ──────────────────────────────────────────────
  if (await tableExists(s, schema, "coordinations")) {
    if (!(await columnExists(s, schema, "coordinations", "external_contact_id"))) {
      await s.query(`ALTER TABLE "${schema}"."coordinations" ADD COLUMN external_contact_id UUID`);
      log(`✓ ${schema}: coordinations.external_contact_id añadida`);
    }
    if (!(await constraintExists(s, schema, "coordinations_external_contact_fk"))) {
      // SET NULL y no CASCADE: borrar un contacto NO puede llevarse por delante
      // un acta clínica. El acta se queda, sin contacto asociado.
      await s.query(`
        ALTER TABLE "${schema}"."coordinations"
          ADD CONSTRAINT coordinations_external_contact_fk
          FOREIGN KEY (external_contact_id)
          REFERENCES "${schema}"."external_contacts"(id) ON DELETE SET NULL
      `);
      log(`✓ ${schema}: FK coordinations → external_contacts (ON DELETE SET NULL)`);
    }
    await s.query(`CREATE INDEX IF NOT EXISTS "coordinations_external_contact_idx" ON "${schema}"."coordinations" (external_contact_id)`);
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
    process.stdout.write(`\n▶ Contactos externos · ${schemas.length} schema(s)\n\n`);
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
