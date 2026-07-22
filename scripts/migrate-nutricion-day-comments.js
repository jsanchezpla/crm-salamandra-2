/**
 * migrate-nutricion-day-comments.js
 *
 * Rediseño del editor de menús (2026-07-22, Rodrigo): cada día de la semana
 * puede llevar sus propios comentarios ("el lunes hacemos batch cooking…"),
 * además de los comentarios por comida (plan_meals.description, ya existía) y
 * los generales del menú (plans.description).
 *
 *   - plans.day_comments JSONB NOT NULL DEFAULT '{}' — mapa
 *     { "1": "texto del lunes", … "7": "texto del domingo" }. JSONB en vez de
 *     tabla nueva: son 7 textos por menú como máximo, sin relaciones.
 *
 * Selecciona schemas por EXISTENCIA de la tabla (scripts/_schema-targets.js).
 * Aditiva e idempotente. Transacción por schema.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-day-comments.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-day-comments.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — comentarios por día del menú\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `plans`...");
  const { schemas } = await byTable(s, "plans");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."plans"
             ADD COLUMN IF NOT EXISTS day_comments JSONB NOT NULL DEFAULT '{}'::jsonb`,
          { transaction: t }
        );
      });
      log(`✓ ${schema}: plans.day_comments listo`);
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
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
