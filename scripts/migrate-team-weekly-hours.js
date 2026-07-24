/**
 * migrate-team-weekly-hours.js
 *
 * Añade a cada MIEMBRO DEL EQUIPO sus horas de INTERVENCIÓN DIRECTA por semana:
 *
 *   - team_members.weekly_direct_hours INTEGER NULL.
 *
 * Es el denominador de la productividad (% horas de intervención directa sobre
 * disponibles). Nullable a propósito: NULL = "sin objetivo configurado" → la
 * productividad de esa persona sale como N/D hasta que Dirección lo fije. El
 * "-5h/semana" de algunos roles se representa simplemente con un número menor,
 * sin hardcodear a nadie.
 *
 * El modelo referencia weeklyDirectHours en todos los tenants con tabla
 * team_members, por eso se añade SIEMPRE (si faltara → 42703).
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-team-weekly-hours.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-team-weekly-hours.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: equipo → horas directas/semana\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "team_members");
  if (schemas.length === 0) log("· Ningún schema con tabla team_members.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."team_members"
           ADD COLUMN IF NOT EXISTS weekly_direct_hours INTEGER`
      );
      log(`✓ ${schema}: team_members.weekly_direct_hours listo`);
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
