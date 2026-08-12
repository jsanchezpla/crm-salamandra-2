/**
 * migrate-rename-therapist-to-employee.js
 *
 * Renombra `therapist_id` → `employee_id` en las tablas `rates`, `invoices`
 * y `costs` de TODOS los schemas de tenant (`crm_{slug}`). Renombra también
 * cualquier índice o constraint cuyo nombre contenga "therapist".
 *
 * Estrategia: UNA sola transacción global. Si algo falla, rollback total
 * y ningún schema queda a medias. Idempotente: si ya está migrado o el
 * tenant no tiene esa tabla (porque no usa el módulo billing), se loguea
 * y se sigue sin error.
 *
 * Uso: npm run db:migrate:rename-therapist
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

const TABLES = ["rates", "invoices", "costs"];
const OLD_COL = "therapist_id";
const NEW_COL = "employee_id";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function fetchTargetSlugs(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT slug FROM master.tenants ORDER BY slug`
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

async function processColumn(sequelize, t, schema, table) {
  const exists = await tableExists(sequelize, t, schema, table);
  if (!exists) {
    log(`· ${schema}.${table}: tabla no existe (tenant sin billing), saltando`);
    return;
  }

  const hasOld = await columnExists(sequelize, t, schema, table, OLD_COL);
  const hasNew = await columnExists(sequelize, t, schema, table, NEW_COL);

  if (hasNew && !hasOld) {
    log(`· ${schema}.${table}: ya migrada (employee_id existe), saltando`);
    return;
  }
  if (!hasOld && !hasNew) {
    log(`· ${schema}.${table}: ni therapist_id ni employee_id, saltando`);
    return;
  }
  if (hasOld && hasNew) {
    throw new Error(
      `${schema}.${table}: tiene AMBAS columnas (therapist_id y employee_id). ` +
      `Estado inconsistente, abortando para preservar datos.`
    );
  }

  // hasOld && !hasNew → renombrar
  await sequelize.query(
    `ALTER TABLE "${schema}"."${table}" RENAME COLUMN "${OLD_COL}" TO "${NEW_COL}"`,
    { transaction: t }
  );
  log(`✓ ${schema}.${table}: ${OLD_COL} → ${NEW_COL}`);
}

async function renameIndexesAndConstraints(sequelize, t, schema) {
  // Índices
  const [idxRows] = await sequelize.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = $1 AND indexname LIKE '%therapist%'`,
    { bind: [schema], transaction: t }
  );
  for (const { indexname } of idxRows) {
    const newName = indexname.replace(/therapist/g, "employee");
    // Si el índice con el nombre NUEVO ya existe, renombrar choca con
    // "la relación «X» ya existe" y tumba toda la migración. Pasa en cualquier
    // schema donde Sequelize (db:sync) ya creó el índice desde el modelo, que
    // usa el nombre nuevo: el viejo se queda como duplicado inofensivo.
    const [existe] = await sequelize.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
      { bind: [schema, newName], transaction: t }
    );
    if (existe.length) {
      log(`· ${schema} index: ${newName} ya existe — se deja ${indexname} como duplicado`);
      continue;
    }
    await sequelize.query(
      `ALTER INDEX "${schema}"."${indexname}" RENAME TO "${newName}"`,
      { transaction: t }
    );
    log(`✓ ${schema} index: ${indexname} → ${newName}`);
  }

  // Constraints (FK, CHECK, UNIQUE...)
  const [conRows] = await sequelize.query(
    `SELECT c.conname,
            n.nspname AS schemaname,
            cl.relname AS tablename
     FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     JOIN pg_class cl ON cl.oid = c.conrelid
     WHERE n.nspname = $1 AND c.conname LIKE '%therapist%'`,
    { bind: [schema], transaction: t }
  );
  for (const { conname, schemaname, tablename } of conRows) {
    const newName = conname.replace(/therapist/g, "employee");
    // Mismo blindaje que con los índices: si la constraint nueva ya existe
    // (creada por db:sync desde el modelo), no se renombra.
    const [existe] = await sequelize.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.conname = $2`,
      { bind: [schemaname, newName], transaction: t }
    );
    if (existe.length) {
      log(`· ${schema} constraint: ${newName} ya existe — se deja ${conname} como duplicada`);
      continue;
    }
    await sequelize.query(
      `ALTER TABLE "${schemaname}"."${tablename}" RENAME CONSTRAINT "${conname}" TO "${newName}"`,
      { transaction: t }
    );
    log(`✓ ${schema} constraint ${tablename}.${conname} → ${newName}`);
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: therapist_id → employee_id (multi-tenant) \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchTargetSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Aplicando renombre dentro de transacción global...");
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        for (const table of TABLES) {
          await processColumn(sequelize, t, schema, table);
        }
        await renameIndexesAndConstraints(sequelize, t, schema);
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
