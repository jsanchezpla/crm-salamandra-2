/**
 * migrate-usuario-backoffice.js — separa las cuentas del back-office de las del CRM.
 *
 * Añade `solo_backoffice` a `master.users`. Con esa marca:
 *   · una cuenta de back-office SOLO entra por admin.salamandrasolutions.com;
 *   · una cuenta normal del CRM NO entra por ahí.
 *
 * ── POR QUÉ NO BASTABA CON SEPARAR POR TENANT ────────────────────────────────
 * El panel interno guarda la ficha de todos los clientes, y hasta ahora lo abría
 * la MISMA cuenta que el CRM de Salamandra: una contraseña robada daba las dos
 * cosas. Lo evidente sería reservar el tenant `salamandra_solutions` para el
 * panel, pero ese tenant usa su CRM de verdad —facturación, proyectos, clientes,
 * con datos dentro—, así que bloquearlo del CRM habría roto su trabajo diario.
 * La separación tiene que ser por USUARIO, no por cliente.
 *
 * Es una sola columna en `master`, no por tenant: aditiva, con default `false`,
 * así que ninguna cuenta existente cambia de comportamiento al aplicarla.
 *
 * Idempotente.
 *
 * Uso:
 *   npm run db:migrate:backoffice        (local)
 *   npm run db:migrate:backoffice:prod   (producción)
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  process.stdout.write("\n▶ Migración: cuentas propias para el back-office\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    await s.query(
      `ALTER TABLE "master"."users"
         ADD COLUMN IF NOT EXISTS "solo_backoffice" BOOLEAN NOT NULL DEFAULT FALSE`
    );
    log("✓ master.users.solo_backoffice");

    const [filas] = await s.query(
      `SELECT count(*) FILTER (WHERE solo_backoffice) AS backoffice,
              count(*)                                AS total
         FROM master.users`
    );
    log(`· ${filas[0].backoffice} cuenta(s) de back-office de ${filas[0].total} en total`);

    // Comprobación real, no la fe en que el ALTER haya ido bien.
    const [col] = await s.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='master' AND table_name='users' AND column_name='solo_backoffice'`
    );
    if (!col.length) {
      process.stderr.write("\n✗ La columna NO está. NO desplegar.\n\n");
      await s.close();
      process.exit(1);
    }

    process.stdout.write("\n✓ Migración completada\n\n");
    await s.close();
  } catch (err) {
    process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
    await s.close();
    process.exit(1);
  }
}

main();
