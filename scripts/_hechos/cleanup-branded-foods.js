/**
 * cleanup-branded-foods.js — retira del catálogo los productos de marca.
 *
 * Decisión de producto (Rodrigo + Jorge, 2026-07-22): el catálogo de alimentos
 * debe contener ALIMENTOS con sus valores nutricionales, no ofertas de
 * supermercado ("Ensalada césar Florette", "Lasaña Hacendado"…). El catálogo
 * branded (2.925 productos de Open Food Facts, sembrado por
 * seed-foods-branded-catalog.js) fue un malentendido y se retira.
 *
 * QUÉ HACE: archiva (soft-delete, archived_at=now()) los foods que vinieron del
 * seed branded, identificados por su firma exacta:
 *   source='openfoodfacts' AND 'marca' = ANY(tags)
 * Eso NO toca:
 *   - los ~500 del catálogo base (source='custom')
 *   - los alimentos creados a mano por la nutricionista (source='custom')
 *   - sus importaciones antiguas de OFF (source='openfoodfacts' SIN tag 'marca')
 *
 * POR QUÉ ARCHIVAR y no borrar:
 *   - food_id tiene FK ON DELETE RESTRICT desde 3 tablas: un DELETE de un
 *     alimento usado en un plan/receta falla a nivel Postgres.
 *   - Un alimento archivado desaparece de búsquedas y listados, pero los planes
 *     que ya lo referencien siguen calculando macros con normalidad.
 *   - Los seeds saltan filas archivadas → no resucitan al re-sembrar. (El seed
 *     branded además se elimina del repo en este mismo commit.)
 *
 * Idempotente (re-ejecutar archiva 0). Recorre todos los tenants activos con
 * tabla foods (regla #12: lee master.tenants, no hardcodea slugs).
 *
 * Uso local:  node --env-file=.env.local scripts/cleanup-branded-foods.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/cleanup-branded-foods.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "../_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Saneo de catálogo: fuera los productos de marca\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `foods`...");
  const { schemas } = await byTable(s, "foods");
  if (schemas.length === 0) log("· Ninguno. Nada que hacer.");

  for (const schema of schemas) {
    try {
      // Cuántos de los que se van a archivar están referenciados (informativo:
      // archivar es seguro igualmente, los planes siguen calculando).
      const [[ref]] = await s.query(`
        SELECT count(DISTINCT f.id)::int AS n
        FROM "${schema}"."foods" f
        WHERE f.source = 'openfoodfacts' AND 'marca' = ANY(f.tags) AND f.archived_at IS NULL
          AND (EXISTS (SELECT 1 FROM "${schema}"."plan_meal_option_foods" x WHERE x.food_id = f.id)
            OR EXISTS (SELECT 1 FROM "${schema}"."recipe_foods" x WHERE x.food_id = f.id)
            OR EXISTS (SELECT 1 FROM "${schema}"."plan_meal_option_recipe_foods" x WHERE x.food_id = f.id))
      `);
      const [, meta] = await s.query(`
        UPDATE "${schema}"."foods"
           SET archived_at = now(), updated_at = now()
         WHERE source = 'openfoodfacts' AND 'marca' = ANY(tags) AND archived_at IS NULL
      `);
      const archived = meta?.rowCount ?? 0;
      const nota = ref.n > 0 ? ` (${ref.n} estaban en uso: sus planes siguen funcionando)` : "";
      log(`✓ ${schema}: ${archived} productos de marca archivados${nota}`);
    } catch (err) {
      // Tenant con foods pero sin las tablas de planes/recetas (42P01): archiva
      // sin el recuento informativo.
      if (err?.parent?.code === "42P01" || err?.original?.code === "42P01") {
        const [, meta] = await s.query(`
          UPDATE "${schema}"."foods"
             SET archived_at = now(), updated_at = now()
           WHERE source = 'openfoodfacts' AND 'marca' = ANY(tags) AND archived_at IS NULL
        `);
        log(`✓ ${schema}: ${meta?.rowCount ?? 0} productos de marca archivados`);
      } else {
        log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
      }
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Saneo completado\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
