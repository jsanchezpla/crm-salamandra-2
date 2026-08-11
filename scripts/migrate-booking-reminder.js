/**
 * migrate-booking-reminder.js — columna `reminder_sent_at` en `bookings`.
 *
 * La usa el recordatorio automático de la víspera para saber a quién ya se le
 * escribió. Sin ella, cada pasada del temporizador volvería a mandar el mismo
 * correo a la misma persona: el recordatorio se convertiría en spam justo con
 * los pacientes que más cuidado requieren.
 *
 * Aditiva e idempotente. Va en MODULES.citas (solo tiene sentido donde hay
 * tabla bookings), con índice parcial para que la consulta de "a quién toca
 * avisar" no recorra el histórico entero.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-booking-reminder.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-booking-reminder.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemasConBookings(s) {
  const [rows] = await s.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = 'bookings' AND table_schema LIKE 'crm_%'
      ORDER BY table_schema`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.table_schema));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  const schemas = await schemasConBookings(s);
  header(`reminder_sent_at en ${schemas.length} schema(s) con bookings`);

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`
      );
      // Índice parcial: solo las citas futuras SIN recordatorio son candidatas.
      await s.query(
        `CREATE INDEX IF NOT EXISTS bookings_reminder_pendiente_idx
           ON "${schema}"."bookings" (scheduled_at)
         WHERE reminder_sent_at IS NULL`
      );
      log(`✓ ${schema}`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message}`);
    }
  }

  await s.close();
  header("Hecho.");
}

main().catch((err) => { console.error(err); process.exit(1); });
