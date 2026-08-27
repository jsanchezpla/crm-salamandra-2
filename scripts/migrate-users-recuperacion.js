/**
 * migrate-users-recuperacion.js — el enlace de «¿Olvidaste tu contraseña?».
 *
 * Añade a `master.users` las dos columnas del enlace de recuperación:
 *
 *   · `reset_token_hash`   — el RESUMEN (sha256, hex) del token que va en el
 *     enlace del correo. Nunca el token en claro: quien lea la base de datos
 *     no puede reconstruir el enlace.
 *   · `reset_token_expira` — hasta cuándo vale. Caducidad corta (la pone
 *     `lib/auth/recuperacion.js`); pasada la hora, el enlace es papel mojado
 *     aunque la fila siga ahí.
 *
 * Una fila = un token como mucho: pedir otro enlace PISA el anterior, que es
 * lo que se quiere — el correo más reciente es el único que abre.
 *
 * Es en `master`, no por tenant: la recuperación empieza sin sesión y sin
 * saber de qué cliente es quien la pide.
 *
 * Aditiva e idempotente: las columnas nacen NULL y ninguna cuenta cambia de
 * comportamiento al aplicarla.
 *
 * Uso:
 *   npm run db:migrate:recuperacion       (local)
 *   docker exec crm-salamandra-app-1 node scripts/migrate-users-recuperacion.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  process.stdout.write("\n▶ Migración: el enlace de recuperación de contraseña\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    await s.query(
      `ALTER TABLE "master"."users"
         ADD COLUMN IF NOT EXISTS "reset_token_hash" VARCHAR(64)`
    );
    log("✓ master.users.reset_token_hash");

    await s.query(
      `ALTER TABLE "master"."users"
         ADD COLUMN IF NOT EXISTS "reset_token_expira" TIMESTAMPTZ`
    );
    log("✓ master.users.reset_token_expira");

    const [[f]] = await s.query(
      `SELECT count(*)                                          AS total,
              count(*) FILTER (WHERE email_contacto IS NOT NULL) AS con_correo,
              count(*) FILTER (WHERE role = 'admin')             AS admins
         FROM master.users`
    );
    log(`· ${f.total} cuentas · ${f.admins} admins · ${f.con_correo} con correo de contacto`);

    process.stdout.write("\n✓ Migración completada\n\n");
  } catch (err) {
    process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
    process.exitCode = 1;
  } finally {
    await s.close();
  }
}

main();
