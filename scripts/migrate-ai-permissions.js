/**
 * migrate-ai-permissions.js — crea la tabla `ai_permissions` en TODOS los
 * schemas crm_* (transversal: cualquier tenant puede restringir la IA).
 *
 * Guarda las SOLICITUDES Y CONCESIONES de permiso para usar la IA de pago
 * (Claude/Whisper/Places) cuando el tenant activa settings.aiAccess =
 * "restringido": un empleado sin permiso dispara una solicitud; el admin la
 * concede (para siempre o para una sola vez), la deniega o la revoca.
 *
 * Sin FK a users: `user_id` y `decided_by` son referencias lógicas a
 * master.users (mismo criterio que notifications.user_id — no hay FK entre
 * schemas).
 *
 * Idempotente (IF NOT EXISTS). Aditiva. Va en CORE.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-ai-permissions.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-ai-permissions.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }

  const schemas = await listSchemas(s);
  header(`ai_permissions en ${schemas.length} schemas`);

  for (const schema of schemas) {
    try {
      await s.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."ai_permissions" (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID NOT NULL,
          status      VARCHAR(20) NOT NULL DEFAULT 'pendiente',
          scope       VARCHAR(20),
          accion      VARCHAR(200),
          used_at     TIMESTAMPTZ,
          decided_by  UUID,
          decided_at  TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await s.query(
        `CREATE INDEX IF NOT EXISTS ai_permissions_user_status_idx ON "${schema}"."ai_permissions" (user_id, status)`
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
