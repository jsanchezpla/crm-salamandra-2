/**
 * migrate-packs-sesiones.js
 *
 * Bonos de sesiones, precio fraccionado y formulario por tipo de cita.
 *
 * Hasta hoy un tipo de cita era UNA cita con UN precio. Lo que se vende de
 * verdad son programas: «10 sesiones por 360 €, o 3 meses de 130 €». Y hacía
 * falta poder mirar el calendario y ver por dónde va cada persona («3 de 10»)
 * sin abrir la ficha ni contar a mano.
 *
 * Qué hace:
 *   1. `event_types`: `sessions_count` (1 = cita suelta, N = pack),
 *      `instalment_price` + `instalment_months` (el fraccionado, que es un
 *      precio INDEPENDIENTE del de pago único: financiar cuesta más) y
 *      `form_id` (formulario a rellenar tras elegir fecha y hora).
 *   2. `session_packs`: el bono de una persona. Tabla nueva.
 *   3. `bookings`: `pack_id` + `session_number` (qué número de sesión es) y
 *      `form_answers`.
 *
 * Las sesiones consumidas NO se guardan en ninguna columna: se cuentan desde
 * las propias citas (`lib/citas/packs.js`). Un contador que hay que acordarse
 * de subir y bajar en cada cancelación acaba mintiendo.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-packs-sesiones.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-packs-sesiones.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const PACKS = "session_packs";

async function ampliarTipos(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."event_types"
       ADD COLUMN IF NOT EXISTS sessions_count    INTEGER NOT NULL DEFAULT 1,
       ADD COLUMN IF NOT EXISTS instalment_price  INTEGER,
       ADD COLUMN IF NOT EXISTS instalment_months INTEGER,
       ADD COLUMN IF NOT EXISTS form_id           UUID`,
    { transaction: t }
  );

  // El formulario es opcional y puede borrarse desde su propia pantalla: si se
  // borra, el tipo de cita se queda SIN formulario, no roto.
  if (await tableExists(s, schema, "forms")) {
    await s.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'event_types_form_fk'
                           AND connamespace = '${schema}'::regnamespace)
         THEN
           ALTER TABLE "${schema}"."event_types"
             ADD CONSTRAINT event_types_form_fk
             FOREIGN KEY (form_id) REFERENCES "${schema}"."forms"(id)
             ON DELETE SET NULL;
         END IF;
       END $$;`,
      { transaction: t }
    );
  }
}

async function crearPacks(s, schema, t) {
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${PACKS}" (
       id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_email       VARCHAR(255) NOT NULL,
       client_id          UUID,
       event_type_id      UUID NOT NULL,
       total_sessions     INTEGER NOT NULL,
       pricing_mode       VARCHAR(20) NOT NULL DEFAULT 'upfront',
       amount             INTEGER,
       instalment_amount  INTEGER,
       instalment_months  INTEGER,
       payment_session_id UUID,
       purchased_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
       status             VARCHAR(20) NOT NULL DEFAULT 'active',
       notes              TEXT,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE INDEX IF NOT EXISTS session_packs_email_type_idx
       ON "${schema}"."${PACKS}" (client_email, event_type_id, status)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS session_packs_client_idx ON "${schema}"."${PACKS}" (client_id)`,
    { transaction: t }
  );

  // Borrar la ficha NO borra el bono (queda el rastro de lo que se cobró);
  // borrar el tipo de cita tampoco puede, por eso va con RESTRICT implícito
  // solo donde existe la tabla.
  await s.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'session_packs_client_fk'
                         AND connamespace = '${schema}'::regnamespace)
       THEN
         ALTER TABLE "${schema}"."${PACKS}"
           ADD CONSTRAINT session_packs_client_fk
           FOREIGN KEY (client_id) REFERENCES "${schema}"."clients"(id)
           ON DELETE SET NULL;
       END IF;
     END $$;`,
    { transaction: t }
  );
}

async function ampliarReservas(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."bookings"
       ADD COLUMN IF NOT EXISTS pack_id        UUID,
       ADD COLUMN IF NOT EXISTS session_number INTEGER,
       ADD COLUMN IF NOT EXISTS form_answers   JSONB`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS bookings_pack_idx ON "${schema}"."bookings" (pack_id)`,
    { transaction: t }
  );

  // Anular un bono no puede borrar las citas que ya se dieron: quedan huérfanas
  // y a la vista, con su número intacto.
  if (await tableExists(s, schema, PACKS)) {
    await s.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'bookings_pack_fk'
                           AND connamespace = '${schema}'::regnamespace)
         THEN
           ALTER TABLE "${schema}"."bookings"
             ADD CONSTRAINT bookings_pack_fk
             FOREIGN KEY (pack_id) REFERENCES "${schema}"."${PACKS}"(id)
             ON DELETE SET NULL;
         END IF;
       END $$;`,
      { transaction: t }
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Bonos de sesiones, precio fraccionado y formulario\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Pasada 1 — schemas con el módulo `citas` (crear la tabla de bonos)");
  const { schemas: conModulo } = await byModule(s, "citas");
  if (conModulo.length === 0) log("· Ninguno todavía.");
  for (const schema of conModulo) {
    try {
      await s.transaction(async (t) => { await crearPacks(s, schema, t); });
      log(`✓ ${schema}: ${PACKS} al día`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Pasada 2 — schemas con `event_types` (sesiones, precios y formulario)");
  const { schemas: conTipos } = await byTable(s, "event_types");
  if (conTipos.length === 0) log("· Ninguno.");
  for (const schema of conTipos) {
    try {
      await s.transaction(async (t) => { await ampliarTipos(s, schema, t); });
      log(`✓ ${schema}: tipos de cita ampliados`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Pasada 3 — schemas con `bookings` (bono y número de sesión)");
  const { schemas: conReservas } = await byTable(s, "bookings");
  if (conReservas.length === 0) log("· Ninguno.");
  for (const schema of conReservas) {
    try {
      await s.transaction(async (t) => { await ampliarReservas(s, schema, t); });
      log(`✓ ${schema}: reservas ampliadas`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
