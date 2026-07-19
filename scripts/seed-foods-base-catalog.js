/**
 * seed-foods-base-catalog.js — Seed del catálogo base de alimentos (Nutrición).
 *
 * Para CADA tenant activo (lista de master.tenants en runtime — regla #12):
 *   - Si su schema no existe o no tiene la tabla `foods` (solo la tienen los
 *     tenants con el módulo nutricion materializado), se omite con un log.
 *   - Inserta los ~500 alimentos genéricos de scripts/data/foods-base-catalog.mjs
 *     que aún no existan. Idempotente POR SLUG (mismo slugifyName que usa la
 *     app): NUNCA se actualizan filas existentes, así las ediciones de la
 *     nutricionista sobre un alimento ya insertado se respetan.
 *   - source='custom', tags = [categoría primaria], archived_at = NULL y
 *     household_measures = seed por defecto (HOUSEHOLD_MEASURES_SEED de
 *     lib/nutricion/foods.js, el mismo que aplica la app al crear alimentos).
 *
 * Transacción por-tenant; un fallo en un tenant no aborta el resto.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-foods-base-catalog.js
 */

import { Sequelize } from "sequelize";
import { DEFAULT_UNITS, HOUSEHOLD_MEASURES_SEED, slugifyName } from "../lib/nutricion/foods.js";
import { BASE_FOODS } from "./data/foods-base-catalog.mjs";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const VALID_TAGS = new Set([
  "carnes", "pescados-mariscos", "huevos", "lacteos", "verduras-hortalizas", "frutas",
  "cereales-derivados", "legumbres", "frutos-secos-semillas", "aceites-grasas", "bebidas",
  "condimentos-salsas", "procesados", "dulces-reposteria", "setas", "tuberculos",
]);
const MACRO_KEYS = ["protein", "carbs", "fat", "fiber"];
const INSERT_CHUNK_SIZE = 100;

// ─── Validación del catálogo (falla rápido ante datos corruptos) ─────────────
function buildCatalog() {
  const seenSlugs = new Map();
  const catalog = [];
  for (const food of BASE_FOODS) {
    const slug = slugifyName(food.name);
    if (!slug) throw new Error(`Alimento sin slug válido: "${food.name}"`);
    if (seenSlugs.has(slug)) {
      throw new Error(`Slug duplicado "${slug}" ("${seenSlugs.get(slug)}" vs "${food.name}")`);
    }
    seenSlugs.set(slug, food.name);
    if (!DEFAULT_UNITS.has(food.unit)) {
      throw new Error(`Unidad inválida "${food.unit}" en "${food.name}"`);
    }
    if (!Array.isArray(food.tags) || food.tags.length !== 1 || !VALID_TAGS.has(food.tags[0])) {
      throw new Error(`Tag inválido en "${food.name}": ${JSON.stringify(food.tags)}`);
    }
    for (const key of MACRO_KEYS) {
      const value = food[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`Macro "${key}" inválida en "${food.name}": ${value}`);
      }
    }
    catalog.push({ ...food, slug });
  }
  return catalog;
}

// ─── Introspección ──────────────────────────────────────────────────────────
async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`);
  return rows.map((r) => r.slug);
}

// ─── Seed por schema ─────────────────────────────────────────────────────────
async function seedSchema(s, schema, catalog) {
  const measuresJson = JSON.stringify(HOUSEHOLD_MEASURES_SEED);
  return await s.transaction(async (t) => {
    const [rows] = await s.query(
      `SELECT slug FROM "${schema}".foods WHERE slug IS NOT NULL`,
      { transaction: t }
    );
    const existingSlugs = new Set(rows.map((r) => r.slug));
    const missing = catalog.filter((food) => !existingSlugs.has(food.slug));

    for (let i = 0; i < missing.length; i += INSERT_CHUNK_SIZE) {
      const chunk = missing.slice(i, i + INSERT_CHUNK_SIZE);
      const values = [];
      const bind = [];
      for (const food of chunk) {
        const b = bind.length;
        bind.push(
          food.name, food.slug, food.unit,
          food.protein, food.carbs, food.fat, food.fiber,
          measuresJson, food.tags[0]
        );
        values.push(
          `(gen_random_uuid(), $${b + 1}, $${b + 2}, $${b + 3}::"${schema}"."enum_foods_default_unit", ` +
            `$${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, 'custom', ` +
            `ARRAY[$${b + 9}]::TEXT[], NULL, now(), now())`
        );
      }
      await s.query(
        `INSERT INTO "${schema}".foods
           (id, name, slug, default_unit, protein_per_100, carbs_per_100, fat_per_100,
            fiber_per_100, household_measures, source, tags, archived_at, created_at, updated_at)
         VALUES ${values.join(", ")}`,
        { bind, transaction: t }
      );
    }
    return { inserted: missing.length, skipped: catalog.length - missing.length };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Seed: catálogo base de alimentos (Nutrición)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const catalog = buildCatalog();
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  header(`Tenants activos: ${slugs.length} (${slugs.join(", ")}) — catálogo: ${catalog.length} alimentos`);

  let okCount = 0;
  let omittedCount = 0;
  let errCount = 0;
  let totalInserted = 0;
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    if (!/^crm_[a-z0-9_]+$/.test(schema)) { log(`· ${schema}: slug inválido — se omite`); omittedCount++; continue; }
    if (!(await schemaExists(sequelize, schema))) { log(`· ${schema}: schema inexistente — se omite`); omittedCount++; continue; }
    if (!(await tableExists(sequelize, schema, "foods"))) { log(`· ${schema}: sin tabla foods — se omite`); omittedCount++; continue; }
    try {
      const { inserted, skipped } = await seedSchema(sequelize, schema, catalog);
      totalInserted += inserted;
      okCount++;
      log(`✓ ${schema}: ${inserted} insertados, ${skipped} ya existían`);
    } catch (err) {
      errCount++;
      process.stderr.write(`  ✗ ${schema}: ${err.message}\n`);
    }
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` ✓ Seed completado (${okCount} OK, ${omittedCount} omitidos, ${errCount} con error, ${totalInserted} alimentos insertados en total)\n`);
  process.stdout.write("════════════════════════════════════════════════════\n\n");
  await sequelize.close();
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error fatal: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
