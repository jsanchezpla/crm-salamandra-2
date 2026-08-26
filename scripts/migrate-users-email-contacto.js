/**
 * migrate-users-email-contacto.js — el correo de una cuenta, aparte de su usuario.
 *
 * Añade `email_contacto` a `master.users`. Es a dónde se le escribe a esa
 * cuenta, y además un segundo identificador con el que puede entrar. El porqué
 * entero está en `lib/auth/correoCuenta.js`; el resumen es que `email` se llama
 * email y no lo es —18 de las 30 cuentas de producción tienen ahí un nombre de
 * usuario, sin arroba—, así que no había a dónde mandar nada.
 *
 * Es una sola columna en `master`, no por tenant.
 *
 * ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
 * Aditiva e idempotente: la columna nace NULL en todas las filas, así que
 * ninguna cuenta existente cambia de comportamiento al aplicarla. NO escribe ni
 * una fila: rellenar las que se puedan es otro script (`backfill-correo-cuenta.js`)
 * y va aparte a propósito, porque eso sí toca datos.
 *
 * El índice único no puede fallar por los datos: la columna acaba de nacer vacía
 * y en PostgreSQL los NULL no chocan entre sí en un índice único.
 *
 * Idempotente.
 *
 * Uso:
 *   npm run db:migrate:correo-cuenta       (local)
 *   docker exec crm-salamandra-app-1 node scripts/migrate-users-email-contacto.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  process.stdout.write("\n▶ Migración: el correo de cada cuenta, aparte de su usuario\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    await s.query(
      `ALTER TABLE "master"."users"
         ADD COLUMN IF NOT EXISTS "email_contacto" VARCHAR(255)`
    );
    log("✓ master.users.email_contacto");

    // Único porque también sirve para entrar: si dos cuentas compartieran
    // correo, teclearlo señalaría a dos personas.
    await s.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_contacto_uniq"
         ON "master"."users" ("email_contacto")
         WHERE "email_contacto" IS NOT NULL`
    );
    log("✓ índice único users_email_contacto_uniq");

    const [filas] = await s.query(
      `SELECT count(*)                                        AS total,
              count(*) FILTER (WHERE email LIKE '%@%')        AS entran_con_correo,
              count(*) FILTER (WHERE email_contacto IS NOT NULL) AS con_correo_puesto
         FROM master.users`
    );
    const f = filas[0];
    log(`· ${f.total} cuentas · ${f.entran_con_correo} entran ya con un correo · ${f.con_correo_puesto} tienen correo asignado`);
    const sinNinguno = Number(f.total) - Number(f.entran_con_correo) - Number(f.con_correo_puesto);
    if (sinNinguno > 0) {
      log(`· quedan ~${sinNinguno} sin ninguna dirección: eso lo arregla backfill-correo-cuenta.js`);
    }

    // Comprobación real, no la fe en que el ALTER haya ido bien.
    const [col] = await s.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='master' AND table_name='users' AND column_name='email_contacto'`
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
