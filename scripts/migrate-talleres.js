/**
 * migrate-talleres.js — talleres y sus inscripciones (02/08/2026).
 *
 * Sale de la migración de Aumenta: «H.H.S.S.» (Habilidades Sociales) figuraba en
 * Organízate como una ESPECIALIDAD más y así iba a importarse. Rodrigo lo
 * corrigió: es un TALLER. Son 4.287 citas del historial, así que no es un
 * detalle: sin esto no tienen dónde caer.
 *
 * Aditiva e idempotente. No-op en schemas sin `patients` (sin módulo clínico).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-talleres.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-talleres.js
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
 * Solo se traga el 42830 ("tabla referenciada sin restricción única"), que es el
 * de los schemas-foto tipo `crm_demo_golden`, copiados sin clave primaria.
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
  if (!(await tableExists(s, schema, "patients"))) {
    log(`· ${schema}: sin módulo clínico, se salta`);
    return;
  }

  const pk = uuidDefault ? "DEFAULT gen_random_uuid()" : "";

  if (!(await tableExists(s, schema, "talleres"))) {
    await s.query(`
      CREATE TABLE "${schema}"."talleres" (
        id             UUID PRIMARY KEY ${pk},
        name           VARCHAR(160) NOT NULL,
        description    TEXT,
        team_member_id UUID,
        schedule       VARCHAR(120),
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        notes          TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla talleres creada`);
  } else {
    log(`· ${schema}: talleres ya existía`);
  }
  await s.query(`CREATE INDEX IF NOT EXISTS "talleres_active_idx" ON "${schema}"."talleres" (active)`);
  await s.query(`CREATE INDEX IF NOT EXISTS "talleres_name_idx"   ON "${schema}"."talleres" (name)`);

  if (!(await tableExists(s, schema, "taller_inscripciones"))) {
    await s.query(`
      CREATE TABLE "${schema}"."taller_inscripciones" (
        id         UUID PRIMARY KEY ${pk},
        taller_id  UUID NOT NULL,
        patient_id UUID NOT NULL,
        joined_at  DATE NOT NULL,
        left_at    DATE,
        notes      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log(`✓ ${schema}: tabla taller_inscripciones creada`);
  } else {
    log(`· ${schema}: taller_inscripciones ya existía`);
  }

  await s.query(`CREATE INDEX IF NOT EXISTS "taller_inscripciones_taller_idx"  ON "${schema}"."taller_inscripciones" (taller_id)`);
  await s.query(`CREATE INDEX IF NOT EXISTS "taller_inscripciones_patient_idx" ON "${schema}"."taller_inscripciones" (patient_id)`);

  // Único PARCIAL: no se puede estar apuntado dos veces A LA VEZ al mismo
  // taller, pero sí volver a apuntarse el curso siguiente. Sequelize no sabe
  // expresar un índice parcial, por eso va aquí en SQL.
  await s.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "taller_inscripciones_abierta_unique"
      ON "${schema}"."taller_inscripciones" (taller_id, patient_id)
      WHERE left_at IS NULL
  `);

  if (!(await constraintExists(s, schema, "taller_inscripciones_taller_fk"))) {
    // CASCADE: borrar un taller que nunca llegó a usarse se lleva sus
    // inscripciones. Los que sí se usaron se desactivan (`active = false`), no
    // se borran.
    await intentarFk(s, schema, "taller_inscripciones_taller_fk", `
      ALTER TABLE "${schema}"."taller_inscripciones"
        ADD CONSTRAINT taller_inscripciones_taller_fk
        FOREIGN KEY (taller_id) REFERENCES "${schema}"."talleres"(id) ON DELETE CASCADE
    `);
  }
  if (!(await constraintExists(s, schema, "taller_inscripciones_patient_fk"))) {
    await intentarFk(s, schema, "taller_inscripciones_patient_fk", `
      ALTER TABLE "${schema}"."taller_inscripciones"
        ADD CONSTRAINT taller_inscripciones_patient_fk
        FOREIGN KEY (patient_id) REFERENCES "${schema}"."patients"(id) ON DELETE CASCADE
    `);
  }
  if (await tableExists(s, schema, "team_members")) {
    if (!(await constraintExists(s, schema, "talleres_team_member_fk"))) {
      // SET NULL: si la persona que lo imparte deja el centro, el taller sigue.
      await intentarFk(s, schema, "talleres_team_member_fk", `
        ALTER TABLE "${schema}"."talleres"
          ADD CONSTRAINT talleres_team_member_fk
          FOREIGN KEY (team_member_id) REFERENCES "${schema}"."team_members"(id) ON DELETE SET NULL
      `);
    }
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
    process.stdout.write(`\n▶ Talleres · ${schemas.length} schema(s)\n\n`);
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
