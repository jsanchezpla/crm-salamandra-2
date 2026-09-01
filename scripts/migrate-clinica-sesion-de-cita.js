/**
 * migrate-clinica-sesion-de-cita.js — de qué CITA es un registro de sesión.
 *
 * Añade a `clinic_sessions`, en todo schema que tenga esa tabla:
 *   - `booking_id` UUID NULL: la cita de la que sale este registro.
 *   - índice `clinic_sessions_booking_idx` sobre esa columna.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (01/09/2026, por Rodrigo): «si estoy editando la sesión de
 * una cita y salgo y entro, no me tiene que generar una sesión nueva; tiene que
 * seguir editando la misma hasta que le dé a finalizar».
 *
 * Hasta hoy «Preparar sesión» solo llevaba el paciente y la FECHA, así que cada
 * vuelta al modal abría un formulario en blanco y guardarlo creaba OTRA sesión
 * del mismo día. La fecha no servía para casarlas —se corrige a mano en el
 * propio formulario, y dos citas seguidas del mismo paciente comparten día—:
 * hacía falta la cita. Con la columna, la regla es **una cita, un registro**.
 *
 * SIN FK a `bookings` a propósito, igual que `taller_sesion_id`: borrar una
 * cita del calendario no puede llevarse por delante la nota clínica de la
 * sesión que sí se dio. El puntero se queda colgando y no molesta a nadie.
 *
 * El índice NO es único: si una sesión vieja se adopta a mano y resulta que ya
 * había otra apuntada a la misma cita, prefiero dos filas y que la pantalla
 * elija a un 500 en mitad de la agenda.
 *
 * Sin backfill: nadie tenía dónde guardar esto, así que no hay nada que
 * rellenar. Las sesiones ya escritas se adoptan solas la primera vez que se
 * entra a su cita (la pantalla las reconoce por paciente + fecha exacta y les
 * pone el `booking_id`); ver `sesionDeLaCita` en `lib/clinica/prepararSesion.js`.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el MODELO `ClinicSession` declara `bookingId`,
 * así que Sequelize la pide en cada SELECT. En un schema sin la columna, la
 * primera lectura de /pacientes/[id] revienta con 42703.
 *
 * Idempotente (ADD COLUMN / CREATE INDEX IF NOT EXISTS). Los schemas salen de
 * `byTable` (`scripts/_schema-targets.js`) y no de `byModule`: la columna la
 * declara el modelo para TODOS, así que la necesita cualquier schema que tenga
 * la tabla, haya comprado Clínica o no. `byTable` arrastra además las FOTOS
 * DORADAS de las demos, para que restaurar una no la devuelva sin la columna.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-sesion-de-cita.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-sesion-de-cita.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(
    `ALTER TABLE "${schema}"."clinic_sessions"
       ADD COLUMN IF NOT EXISTS booking_id UUID`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS clinic_sessions_booking_idx
       ON "${schema}"."clinic_sessions" (booking_id)`
  );
  log(`✓ ${schema}.clinic_sessions: booking_id e índice asegurados`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: de qué CITA es un registro de sesión\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(sequelize, "clinic_sessions");
  if (schemas.length === 0) {
    log("· Ningún schema con clinic_sessions.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    await processSchema(sequelize, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
