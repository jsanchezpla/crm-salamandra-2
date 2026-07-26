/**
 * migrate-team-member-hours.js — horario de trabajo semanal PROPIO por terapeuta.
 *
 * Crea `team_member_hours` (día de la semana + franja horaria) para cada tenant
 * con tabla `team_members`. Es el horario de cada profesional, distinto de
 * `availabilities` (que es del centro / por tipo de cita). Lo usa la generación
 * de huecos para proponer/reprogramar citas de un profesional.
 *
 * Aditiva e idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Selecciona schemas
 * por existencia de `team_members` (helper compartido `byTable`, regla #12).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-team-member-hours.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-team-member-hours.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: horario por terapeuta (team_member_hours)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // gen_random_uuid(): nativa desde PG13; pgcrypto por si acaso (sin romper si no hay permiso).
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* ignorar */ }

  const { schemas } = await byTable(s, "team_members");
  if (schemas.length === 0) log("· Ningún schema con tabla team_members.");

  for (const schema of schemas) {
    try {
      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."team_member_hours" (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
           day_of_week INTEGER NOT NULL,
           start_time TIME NOT NULL,
           end_time TIME NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS "team_member_hours_member_day_idx"
           ON "${schema}"."team_member_hours" (team_member_id, day_of_week)`
      );
      log(`✓ ${schema}: team_member_hours listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
