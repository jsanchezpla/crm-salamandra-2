/**
 * migrate-calendar-citas-fks.js
 *
 * Sprint "Calendario/Citas FKs".
 *   - calendar_tasks (todo schema que tenga la tabla): + client_id, + team_member_id
 *     (UUID nullable, FK ON DELETE SET NULL a clients/team_members) + índices.
 *   - bookings (todo schema que tenga la tabla): + team_member_id
 *     (UUID nullable, FK ON DELETE SET NULL a team_members) + índice.
 *     (meet_url ya existía; no se toca.)
 *
 * IMPORTANTE — por qué NO filtra por módulo: si un tenant ya tenía la tabla
 * (creada por un `db:sync` anterior) pero todavía no había comprado Citas o
 * Calendario, la versión antigua lo saltaba. Al activar el módulo más tarde, la
 * tabla seguía sin las columnas y TODA lectura reventaba con 42703 — el bug de
 * las reservas de tunutrilaura.com. Al decidir por existencia de tabla, comprar
 * un módulo hoy y el otro dentro de seis meses es indiferente: re-ejecutar esta
 * migración deja ambos schemas correctos.
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
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// Antes esto filtraba por `module_key`, y ahí estaba el agujero: un tenant que
// ya tenía la tabla creada por un sync anterior pero AÚN no había comprado el
// módulo se quedaba sin las columnas. El día que lo activaba, toda lectura
// reventaba con 42703 (fue el bug de las citas de tunutrilaura.com).
// Ahora se recorren TODOS los tenants activos y se decide por la EXISTENCIA DE
// LA TABLA, no por el módulo: si la tabla está, se blinda; si no está, ya nacerá
// correcta desde el modelo cuando `db:sync` la cree.
async function fetchActiveSlugs(s) {
  const [rows] = await s.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = :schema AND table_name = :table`,
    { replacements: { schema, table } }
  );
  return rows.length > 0;
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

  const slugs = await fetchActiveSlugs(s);
  header(`Tenants activos: ${slugs.length} (${slugs.join(", ")})`);

  let calOk = 0, calSkip = 0, citOk = 0, citSkip = 0;

  header("Calendario — schemas con tabla `calendar_tasks`...");
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    if (!(await tableExists(s, schema, "calendar_tasks"))) {
      log(`· ${schema}: sin tabla calendar_tasks — se omite`);
      calSkip++;
      continue;
    }
    try {
      await processCalendar(s, schema);
      log(`✓ ${schema}: calendar_tasks.client_id + team_member_id listos`);
      calOk++;
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta`);
    }
  }
  if (calOk === 0) log("· Ningún schema con calendar_tasks.");

  header("Citas — schemas con tabla `bookings`...");
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    if (!(await tableExists(s, schema, "bookings"))) {
      log(`· ${schema}: sin tabla bookings — se omite`);
      citSkip++;
      continue;
    }
    try {
      await processCitas(s, schema);
      log(`✓ ${schema}: bookings.team_member_id listo`);
      citOk++;
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta`);
    }
  }
  if (citOk === 0) log("· Ningún schema con bookings.");

  log("");
  log(`Resumen: calendar_tasks ${calOk} blindados / ${calSkip} sin tabla · bookings ${citOk} blindados / ${citSkip} sin tabla`);

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
