/**
 * migrate-waitlist-therapist.js — añade `assigned_therapist_id` a
 * `waitlist_entries` en TODOS los schemas crm_* que tengan la tabla.
 *
 * POR QUÉ (Rodrigo, 01/08/2026): la cola de admisión guardaba nombre, teléfono
 * y especialidad, pero no A QUIÉN se le asigna la familia. En la migración de
 * Aumenta entran 62 pacientes cuyo terapeuta ya no trabaja en el centro: no
 * están "de baja", están **esperando que se les asigne profesional**, que es
 * exactamente para lo que sirve esta cola. Sin esta columna, la lista no puede
 * responder la única pregunta que importa cuando se vacía: quién se queda con
 * cada niño.
 *
 * Nullable a propósito: entrar en la cola SIN terapeuta es un estado legítimo
 * —es el estado normal, de hecho—. Lo que no valía es no poder asignarlo.
 *
 * ON DELETE SET NULL: si el profesional se da de baja, la familia vuelve a
 * quedar pendiente de asignación en vez de irse con él.
 *
 * Aditiva e idempotente. En un schema sin `waitlist_entries` (tenant sin
 * `clients_avanzado`) es un no-op.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-waitlist-therapist.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-waitlist-therapist.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

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
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}

async function constraintExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.conname = $2`,
    { bind: [schema, name] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "waitlist_entries"))) {
    log(`· ${schema}: sin waitlist_entries (no tiene clients_avanzado), se salta`);
    return;
  }

  if (!(await columnExists(s, schema, "waitlist_entries", "assigned_therapist_id"))) {
    await s.query(
      `ALTER TABLE "${schema}"."waitlist_entries" ADD COLUMN assigned_therapist_id UUID`
    );
    log(`✓ ${schema}: columna assigned_therapist_id añadida`);
  } else {
    log(`· ${schema}: la columna ya existía`);
  }

  // La FK solo se puede poner si el tenant tiene equipo. Sin `team_members`
  // (tenant sin el módulo) la columna se queda como referencia suelta, que es
  // lo mismo que hacen el resto de enlaces lógicos del CRM.
  if (
    (await tableExists(s, schema, "team_members")) &&
    !(await constraintExists(s, schema, "waitlist_entries_therapist_fk"))
  ) {
    await s.query(`
      ALTER TABLE "${schema}"."waitlist_entries"
        ADD CONSTRAINT waitlist_entries_therapist_fk
        FOREIGN KEY (assigned_therapist_id)
        REFERENCES "${schema}"."team_members"(id)
        ON DELETE SET NULL
    `);
    log(`✓ ${schema}: FK a team_members (ON DELETE SET NULL)`);
  }

  await s.query(`
    CREATE INDEX IF NOT EXISTS "waitlist_entries_therapist_idx"
      ON "${schema}"."waitlist_entries" (assigned_therapist_id)
  `);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("Falta DATABASE_URL\n");
    process.exit(1);
  }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Terapeuta en la lista de espera · ${schemas.length} schema(s)\n\n`);
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
