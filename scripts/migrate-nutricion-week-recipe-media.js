/**
 * migrate-nutricion-week-recipe-media.js
 *
 * Rework Nutrición 2026-07-22 (decisión de producto Rodrigo+Jorge):
 *   - plan_meals.weekday SMALLINT NULL (1=Lunes … 7=Domingo) + CHECK 1-7.
 *     Da existencia REAL a la semana: hasta ahora los días vivían como texto
 *     libre en plans.description y pulsar un día solo insertaba "Lunes:" en
 *     los comentarios. NULL = comida sin día (planes pre-rework, siguen
 *     funcionando como "menú sin días").
 *   - recipes.photo_path VARCHAR(500) NULL — ruta relativa de la foto en disco
 *     (patrón documentStorage; el fichero vive bajo getUploadsRoot()).
 *   - recipes.steps JSONB NOT NULL DEFAULT '[]' — pasos de preparación.
 *
 * Selecciona los schemas por EXISTENCIA de la tabla, no por módulo (ver
 * scripts/_schema-targets.js y el incidente del 2026-07-21). Aditiva e
 * idempotente: ADD COLUMN IF NOT EXISTS + CHECK en DO block que ignora
 * duplicate_object. Transacción por schema.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-week-recipe-media.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-week-recipe-media.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function processPlanMeals(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."plan_meals"
         ADD COLUMN IF NOT EXISTS weekday SMALLINT`,
      { transaction: t }
    );
    await s.query(
      `DO $$ BEGIN
         ALTER TABLE "${schema}"."plan_meals"
           ADD CONSTRAINT plan_meals_weekday_chk CHECK (weekday IS NULL OR (weekday >= 1 AND weekday <= 7));
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;`,
      { transaction: t }
    );
  });
}

async function processRecipes(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."recipes"
         ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500),
         ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb`,
      { transaction: t }
    );
  });
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — semana real + foto/pasos de receta\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `plan_meals`...");
  const meals = await byTable(sequelize, "plan_meals");
  if (meals.schemas.length === 0) log("· Ninguno.");
  for (const schema of meals.schemas) {
    try {
      await processPlanMeals(sequelize, schema);
      log(`✓ ${schema}: plan_meals.weekday listo (1=Lunes…7=Domingo, NULL=sin día)`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Schemas con tabla `recipes`...");
  const recipes = await byTable(sequelize, "recipes");
  if (recipes.schemas.length === 0) log("· Ninguno.");
  for (const schema of recipes.schemas) {
    try {
      await processRecipes(sequelize, schema);
      log(`✓ ${schema}: recipes.photo_path + recipes.steps listos`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
