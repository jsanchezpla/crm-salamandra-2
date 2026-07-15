/**
 * migrate-calendar-citas-fks.js
 *
 * Sprint "Calendario/Citas FKs".
 *   - calendar_tasks (tenants con módulo `calendar`): + client_id, + team_member_id
 *     (UUID nullable, FK ON DELETE SET NULL a clients/team_members) + índices.
 *   - bookings (tenants con módulo `citas`): + team_member_id
 *     (UUID nullable, FK ON DELETE SET NULL a team_members) + índice.
 *     (meet_url ya existía; no se toca.)
 *
 * Todo ADITIVO + NULLABLE → retrocompatible (nutri_laura en prod incluido).
 * Idempotente: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK dentro
 * de un DO block que ignora duplicate_object/undefined_table. Transacción por
 * tenant. Lee la lista de schemas desde master.tenants en tiempo de ejecución
 * (regla #12), nunca hardcodea slugs.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-calendar-citas-fks.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-calendar-citas-fks.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function fetchSlugs(s, moduleKey) {
  const [rows] = await s.query(
    `SELECT t.slug FROM master.tenants t
       JOIN master.tenant_modules tm ON tm.tenant_id = t.id
      WHERE t.status = 'active' AND tm.module_key = :mk AND tm.enabled = TRUE
      ORDER BY t.slug`,
    { replacements: { mk: moduleKey } }
  );
  return rows.map((r) => r.slug);
}

// FK idempotente y robusta (ignora si ya existe o si faltara la tabla/columna).
async function addFk(s, schema, table, column, refTable, constraint, t) {
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."${table}"
         ADD CONSTRAINT ${constraint}
         FOREIGN KEY (${column}) REFERENCES "${schema}"."${refTable}"(id) ON DELETE SET NULL;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table  THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$;`,
    { transaction: t }
  );
}

async function processCalendar(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."calendar_tasks"
         ADD COLUMN IF NOT EXISTS client_id      UUID,
         ADD COLUMN IF NOT EXISTS team_member_id UUID`,
      { transaction: t }
    );
    await addFk(s, schema, "calendar_tasks", "client_id", "clients", "calendar_tasks_client_id_fkey", t);
    await addFk(s, schema, "calendar_tasks", "team_member_id", "team_members", "calendar_tasks_team_member_id_fkey", t);
    await s.query(`CREATE INDEX IF NOT EXISTS calendar_tasks_client_id_idx ON "${schema}"."calendar_tasks" (client_id)`, { transaction: t });
    await s.query(`CREATE INDEX IF NOT EXISTS calendar_tasks_team_member_id_idx ON "${schema}"."calendar_tasks" (team_member_id)`, { transaction: t });
  });
}

async function processCitas(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."bookings"
         ADD COLUMN IF NOT EXISTS team_member_id UUID`,
      { transaction: t }
    );
    await addFk(s, schema, "bookings", "team_member_id", "team_members", "bookings_team_member_id_fkey", t);
    await s.query(`CREATE INDEX IF NOT EXISTS bookings_team_member_idx ON "${schema}"."bookings" (team_member_id)`, { transaction: t });
  });
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: FKs Calendario/Citas (cliente + team_member)\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Calendario — tenants con módulo `calendar`...");
  const calSlugs = await fetchSlugs(s, "calendar");
  if (calSlugs.length === 0) log("· Ninguno.");
  else log(`✓ ${calSlugs.length}: ${calSlugs.join(", ")}`);
  for (const slug of calSlugs) {
    try {
      await processCalendar(s, `crm_${slug}`);
      log(`  ✓ crm_${slug}: calendar_tasks.client_id + team_member_id listos`);
    } catch (err) {
      log(`  ✗ crm_${slug}: ${err.message} — se salta`);
    }
  }

  header("Citas — tenants con módulo `citas`...");
  const citasSlugs = await fetchSlugs(s, "citas");
  if (citasSlugs.length === 0) log("· Ninguno.");
  else log(`✓ ${citasSlugs.length}: ${citasSlugs.join(", ")}`);
  for (const slug of citasSlugs) {
    try {
      await processCitas(s, `crm_${slug}`);
      log(`  ✓ crm_${slug}: bookings.team_member_id listo`);
    } catch (err) {
      log(`  ✗ crm_${slug}: ${err.message} — se salta`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
