/**
 * migrate-training-fields.js
 *
 * Asegura un índice único sobre `email` en la tabla `training_users` de
 * TODOS los schemas de tenant. Antes de crearlo comprueba si hay
 * duplicados; si los hay, salta ese tenant y lo reporta para limpieza
 * manual.
 *
 * Estrategia: idempotente, lee schemas activos desde `master.tenants`
 * (regla #12 de CLAUDE.md, no hardcodea slugs). NO usa una transacción
 * global para no abortar el resto de tenants si uno tiene duplicados.
 *
 * Uso:
 *   npm run db:migrate:training        (local)
 *   npm run db:migrate:training:prod   (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

const TABLE = "training_users";
const EMAIL_INDEX = "training_users_email_unique";

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

async function tableExists(sequelize, schema, table) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function emailIndexExists(sequelize, schema) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, EMAIL_INDEX] }
  );
  return rows.length > 0;
}

async function findDuplicateEmails(sequelize, schema) {
  const [rows] = await sequelize.query(
    `SELECT email, COUNT(*) AS count
     FROM "${schema}"."${TABLE}"
     WHERE email IS NOT NULL
     GROUP BY email
     HAVING COUNT(*) > 1
     ORDER BY count DESC, email ASC`
  );
  return rows;
}

async function processSchema(sequelize, schema, summary) {
  if (!(await tableExists(sequelize, schema, TABLE))) {
    log(`· ${schema}.${TABLE}: tabla no existe, saltando`);
    summary.skipped.push({ schema, reason: "no-table" });
    return;
  }

  if (await emailIndexExists(sequelize, schema)) {
    log(`· ${schema} index ${EMAIL_INDEX}: ya existe`);
    summary.alreadyDone.push(schema);
    return;
  }

  const duplicates = await findDuplicateEmails(sequelize, schema);
  if (duplicates.length > 0) {
    log(`✗ ${schema}.${TABLE}: ${duplicates.length} email(s) duplicado(s); saltando`);
    for (const d of duplicates) {
      log(`    - ${d.email} (×${d.count})`);
    }
    summary.skipped.push({ schema, reason: "duplicates", duplicates });
    return;
  }

  await sequelize.query(
    `CREATE UNIQUE INDEX "${EMAIL_INDEX}" ON "${schema}"."${TABLE}" (email)`
  );
  log(`✓ ${schema} index ${EMAIL_INDEX}: creado`);
  summary.migrated.push(schema);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: UNIQUE en training_users.email           \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  const summary = { migrated: [], alreadyDone: [], skipped: [] };

  try {
    header("Obteniendo lista de tenants activos...");
    const slugs = await fetchTargetSlugs(sequelize);
    if (slugs.length === 0) {
      log("· No hay tenants activos. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Procesando cada schema...");
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      try {
        await processSchema(sequelize, schema, summary);
      } catch (err) {
        log(`✗ ${schema}: error ${err.message}`);
        summary.skipped.push({ schema, reason: "error", error: err.message });
      }
    }

    process.stdout.write("\n════════════════════════════════════════════════════\n");
    process.stdout.write(" Resumen                                              \n");
    process.stdout.write("════════════════════════════════════════════════════\n");
    log(`Migrados:        ${summary.migrated.length} (${summary.migrated.join(", ") || "—"})`);
    log(`Ya tenían UNIQUE: ${summary.alreadyDone.length} (${summary.alreadyDone.join(", ") || "—"})`);
    log(`Saltados:        ${summary.skipped.length}`);
    for (const s of summary.skipped) {
      log(`  · ${s.schema} (${s.reason})`);
    }

    const hasUnresolvedDuplicates = summary.skipped.some((s) => s.reason === "duplicates");
    if (hasUnresolvedDuplicates) {
      process.stdout.write(
        "\n⚠ Algunos tenants no se han migrado por duplicados. Limpiar manualmente y reejecutar.\n\n"
      );
    } else {
      process.stdout.write("\n✓ Migración completada\n\n");
    }

    await sequelize.close();
    process.exit(hasUnresolvedDuplicates ? 2 : 0);
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
