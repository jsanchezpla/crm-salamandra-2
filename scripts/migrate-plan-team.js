/**
 * migrate-plan-team.js
 *
 * Conecta cada PLAN nutricional con el nutricionista que lo hizo.
 *
 * Los planes ya sabían para qué cliente eran (plans.client_id), pero no qué
 * miembro del equipo los creó. Con Laura sola da igual; el día que haya una
 * segunda nutricionista, sin esto no se sabría quién hizo cada plan.
 *
 *   - plans.team_member_id UUID NULL, FK a team_members(id) ON DELETE SET NULL.
 *   - Índice por team_member_id.
 *
 * Sin relleno hacia atrás: no hay pista fiable de quién creó los planes viejos.
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-plan-team.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-plan-team.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function addFk(s, schema, table, column, refTable, constraint, t) {
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."${table}"
         ADD CONSTRAINT ${constraint}
         FOREIGN KEY (${column}) REFERENCES "${schema}"."${refTable}"(id) ON DELETE SET NULL;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table  THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: plan nutricional enlazado con su nutricionista\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "plans");
  if (schemas.length === 0) log("· Ningún schema con tabla plans.");

  for (const schema of schemas) {
    try {
      // La COLUMNA se añade SIEMPRE: es un UUID nullable inofensivo, y el
      // modelo Sequelize la referencia en TODOS los tenants con tabla plans
      // (si no existiera, un SELECT reventaría con 42703). La FK es lo único
      // que necesita team_members: addFk hace no-op seguro si no existe.
      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."plans" ADD COLUMN IF NOT EXISTS team_member_id UUID`,
          { transaction: t }
        );
        await addFk(s, schema, "plans", "team_member_id", "team_members", "plans_team_member_id_fkey", t);
        await s.query(
          `CREATE INDEX IF NOT EXISTS plans_team_member_idx ON "${schema}"."plans" (team_member_id)`,
          { transaction: t }
        );
      });
      log(`✓ ${schema}: plans.team_member_id listo`);
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
