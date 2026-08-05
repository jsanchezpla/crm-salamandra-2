/**
 * migrate-citas-tipos-ocultos.js
 *
 * Tipos de cita ocultos y asignados a dedo (05/08/2026).
 *
 * Hay pacientes que pagan FUERA de la pasarela: transferencia desde el
 * extranjero, Bizum a un móvil, PayPal. Ese trato se cierra por WhatsApp y su
 * cita entra en el sistema como gratuita, porque el dinero ya está cobrado.
 * Hasta hoy no había forma de darles su tipo de cita sin ponerlo a la vista de
 * todo el mundo — y un tipo gratuito a la vista es una puerta abierta: alguien
 * se cuela y no se nota hasta la quinta sesión.
 *
 * Qué hace:
 *   1. `event_types.is_hidden` — el tipo no sale en la agenda pública. Solo lo
 *      ve quien tiene un BONO ACTIVO suyo (`lib/citas/tiposVisibles.js`).
 *   2. `session_packs.origin` — cómo se pagó ese bono: `online` (lo creó el
 *      webhook de Stripe, que es lo único que había) o `manual` (lo dio de alta
 *      la profesional tras cobrar por fuera). Sin esta columna no se puede
 *      distinguir un bono cobrado de uno regalado por error.
 *   3. `session_packs.created_by` — quién lo dio de alta a mano.
 *
 * NO toca el interruptor `settings.citas.soloConPago`: vive en el JSONB de
 * `master.tenants` y no necesita columna.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-citas-tipos-ocultos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-citas-tipos-ocultos.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function ocultarTipos(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."event_types"
       ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false`,
    { transaction: t }
  );
  // La agenda pública pregunta siempre por los dos a la vez («los que sirven y
  // se ven»), así que el índice los lleva juntos.
  await s.query(
    `CREATE INDEX IF NOT EXISTS event_types_visibles_idx
       ON "${schema}"."event_types" (active, is_hidden, "order")`,
    { transaction: t }
  );
}

async function marcarOrigenBonos(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."session_packs"
       ADD COLUMN IF NOT EXISTS origin     VARCHAR(20) NOT NULL DEFAULT 'online',
       ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`,
    { transaction: t }
  );
  // Los bonos que ya existían nacieron todos del webhook de Stripe: 'online' es
  // el default correcto para el histórico y no hay nada que rellenar a mano.
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Tipos de cita ocultos y bonos dados a mano\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Pasada 1 — schemas con `event_types` (marca de oculto)");
  const { schemas: conTipos } = await byTable(s, "event_types");
  if (conTipos.length === 0) log("· Ninguno.");
  for (const schema of conTipos) {
    try {
      await s.transaction(async (t) => { await ocultarTipos(s, schema, t); });
      log(`✓ ${schema}: event_types.is_hidden al día`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Pasada 2 — schemas con `session_packs` (origen del bono)");
  const { schemas: conBonos } = await byTable(s, "session_packs");
  if (conBonos.length === 0) log("· Ninguno.");
  for (const schema of conBonos) {
    try {
      await s.transaction(async (t) => { await marcarOrigenBonos(s, schema, t); });
      log(`✓ ${schema}: session_packs.origin al día`);
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
