/**
 * migrate-avisos-cliente.js
 *
 * Tabla `client_notices`: avisos del centro a un cliente concreto («cierro en
 * agosto», «tráete los análisis», «te cambio la cita del martes»).
 *
 * Hasta hoy el CRM solo sabía avisar de cosas que le pasan a UNA CITA. Para
 * cualquier otra cosa había que salirse a escribir desde el correo personal, y
 * ese mensaje dejaba de existir para el sistema: nadie sabía después qué se le
 * había dicho a quién.
 *
 * Un aviso sale por correo Y queda publicado en el portal del cliente. Lo
 * segundo importa más de lo que parece: el correo se pierde entre otros
 * cincuenta y el portal sigue ahí en enero.
 *
 * ── LA CLAVE ES EL EMAIL ────────────────────────────────────────────────────
 * `client_email`, no `client_id`, porque es como identifica el portal (sesión
 * SSO de WordPress con email verificado, igual que `citas-portal/bookings`).
 * Colgarlo de la ficha lo haría invisible para quien reserva por la web sin
 * tener ficha creada.
 *
 * DOS PASADAS, como en `migrate-formularios-module.js`:
 *   1ª CREAR sobre los schemas con el módulo `citas` activo (`byModule`): una
 *      tabla que aún no existe en ningún sitio no la encontraría `byTable`.
 *   2ª BLINDAR (índices) sobre los schemas que YA la tienen (`byTable`), que
 *      alcanza también a donde la creara `db:sync` desde los modelos.
 *
 * Ni un solo slug a mano: las dos pasadas leen `master.tenants` en tiempo de
 * ejecución. Aditiva e idempotente: se puede lanzar cien veces.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-avisos-cliente.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-avisos-cliente.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const TABLA = "client_notices";

async function crearTabla(s, schema, t) {
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA}" (
       id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       client_email        VARCHAR(255) NOT NULL,
       client_id           UUID,
       booking_id          UUID,
       title               VARCHAR(160) NOT NULL,
       body                TEXT NOT NULL,
       created_by_team_id  UUID,
       email_status        VARCHAR(20) NOT NULL DEFAULT 'enviado',
       read_at             TIMESTAMPTZ,
       created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );
}

async function blindar(s, schema, t) {
  // El índice que usa el portal en cada carga.
  await s.query(
    `CREATE INDEX IF NOT EXISTS client_notices_email_created_idx
       ON "${schema}"."${TABLA}" (client_email, created_at)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS client_notices_client_idx
       ON "${schema}"."${TABLA}" (client_id)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS client_notices_booking_idx
       ON "${schema}"."${TABLA}" (booking_id)`,
    { transaction: t }
  );

  // Defaults en BASE DE DATOS, no solo en el modelo: si la tabla la creó
  // `db:sync` puede haberse quedado sin ellos, y entonces un INSERT desde SQL
  // fallaría por NOT NULL. Es el agujero del incidente del 2026-07-21.
  const defaults = [
    ["email_status", "'enviado'"],
    ["created_at", "now()"],
    ["updated_at", "now()"],
  ];
  for (const [columna, valor] of defaults) {
    await s.query(
      `ALTER TABLE "${schema}"."${TABLA}" ALTER COLUMN ${columna} SET DEFAULT ${valor}`,
      { transaction: t }
    );
  }

  // Borrar la cita a la que se refería un aviso NO borra el aviso: lo que se le
  // dijo a alguien se dijo, y perderlo dejaría al cliente con un mensaje en el
  // portal que ya no puede explicarse. Se queda huérfano y a la vista.
  await s.query(
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = '${schema}' AND table_name = 'bookings')
          AND NOT EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname = 'client_notices_booking_fk'
                             AND connamespace = '${schema}'::regnamespace)
       THEN
         ALTER TABLE "${schema}"."${TABLA}"
           ADD CONSTRAINT client_notices_booking_fk
           FOREIGN KEY (booking_id) REFERENCES "${schema}"."bookings"(id)
           ON DELETE SET NULL;
       END IF;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Avisos del centro al cliente (client_notices)\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Pasada 1 — schemas con el módulo `citas` activo (crear)");
  const { schemas: conModulo } = await byModule(s, "citas");
  if (conModulo.length === 0) {
    log("· Ninguno todavía. Se creará cuando algún tenant tenga citas.");
  }
  for (const schema of conModulo) {
    try {
      await s.transaction(async (t) => { await crearTabla(s, schema, t); });
      log(`✓ ${schema}: tabla creada o ya existente`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header(`Pasada 2 — schemas con tabla \`${TABLA}\` (índices, defaults y FK)`);
  const { schemas: conTabla } = await byTable(s, TABLA);
  if (conTabla.length === 0) log("· Ninguno.");
  for (const schema of conTabla) {
    try {
      await s.transaction(async (t) => { await blindar(s, schema, t); });
      log(`✓ ${schema}: índices, defaults y FK al día`);
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
