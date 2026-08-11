/**
 * migrate-team-fields.js
 *
 * Añade los campos del módulo Equipo (#6) a la tabla `team_members` de TODOS
 * los schemas de tenant: email, hourly_cost, hourly_rate, currency, notes.
 * También baja `user_id` a NULL permitido (externos/subcontratados sin User)
 * y crea índice único en email.
 *
 * Estrategia: UNA transacción global. Idempotente. Lee schemas activos desde
 * `master.tenants` (regla #12 de CLAUDE.md, no hardcodea slugs).
 *
 * Uso:
 *   npm run db:migrate:team        (local)
 *   npm run db:migrate:team:prod   (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

const TABLE = "team_members";
const EMAIL_INDEX = "team_members_email_unique";

const COLUMNS = [
  { name: "email", ddl: 'VARCHAR(255)' },
  { name: "hourly_cost", ddl: "NUMERIC(10,2)" },
  { name: "hourly_rate", ddl: "NUMERIC(10,2)" },
  { name: "currency", ddl: "VARCHAR(3) NOT NULL DEFAULT 'EUR'" },
  { name: "notes", ddl: "TEXT" },
];

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function fetchActiveSlugs(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function tableExists(sequelize, t, schema, table) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function columnExists(sequelize, t, schema, table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}

async function isUserIdNotNull(sequelize, t, schema) {
  const [rows] = await sequelize.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = 'user_id'`,
    { bind: [schema, TABLE], transaction: t }
  );
  return rows.length > 0 && rows[0].is_nullable === "NO";
}

async function emailIndexExists(sequelize, t, schema) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, EMAIL_INDEX], transaction: t }
  );
  return rows.length > 0;
}

async function processSchema(sequelize, t, schema) {
  if (!(await tableExists(sequelize, t, schema, TABLE))) {
    log(`· ${schema}.${TABLE}: tabla no existe, saltando`);
    return;
  }

  // 1. Añadir columnas que falten
  for (const col of COLUMNS) {
    if (await columnExists(sequelize, t, schema, TABLE, col.name)) {
      log(`· ${schema}.${TABLE}.${col.name}: ya existe`);
      continue;
    }
    await sequelize.query(
      `ALTER TABLE "${schema}"."${TABLE}" ADD COLUMN "${col.name}" ${col.ddl}`,
      { transaction: t }
    );
    log(`✓ ${schema}.${TABLE}.${col.name}: añadida`);
  }

  // 2. user_id NOT NULL → NULL (externos sin User)
  if (await isUserIdNotNull(sequelize, t, schema)) {
    await sequelize.query(
      `ALTER TABLE "${schema}"."${TABLE}" ALTER COLUMN user_id DROP NOT NULL`,
      { transaction: t }
    );
    log(`✓ ${schema}.${TABLE}.user_id: NOT NULL eliminado`);
  } else {
    log(`· ${schema}.${TABLE}.user_id: ya nullable`);
  }

  // 3. Índice único de email (NULLS DISTINCT por defecto en PG → varios NULL conviven)
  if (await emailIndexExists(sequelize, t, schema)) {
    log(`· ${schema} index ${EMAIL_INDEX}: ya existe`);
  } else {
    await sequelize.query(
      `CREATE UNIQUE INDEX "${EMAIL_INDEX}" ON "${schema}"."${TABLE}" (email)`,
      { transaction: t }
    );
    log(`✓ ${schema} index ${EMAIL_INDEX}: creado`);
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: campos del módulo Equipo (multi-tenant)  \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchActiveSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Aplicando migración dentro de transacción global...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        await processSchema(sequelize, t, schema);
      }
    });

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada con éxito                    \n");
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
