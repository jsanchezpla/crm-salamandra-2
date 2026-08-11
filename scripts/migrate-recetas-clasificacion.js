/**
 * migrate-recetas-clasificacion.js — tipo, etiquetas, alérgenos, preferencias,
 * duración y raciones en las recetas.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * El recetario nació para unas decenas de recetas propias, donde encontrar algo
 * es cuestión de mirar. Al traer las 1.083 de Harbiz (nutri_laura, 04/08/2026)
 * eso deja de ser cierto: sin filtros, buscar «un desayuno vegano sin lactosa
 * de menos de 15 minutos» entre mil tarjetas no es buscar, es rendirse.
 *
 * Los seis campos son los que Laura YA tenía en Harbiz, así que no se inventa
 * nada: 958 recetas traen etiquetas, 730 alérgenos, 502 preferencias, 1.053
 * duración y todas su tipo.
 *
 * `allergens` va aparte de `tags` a propósito. Una etiqueta libre es una ayuda
 * para buscar; un alérgeno es lo que evita mandarle gluten a una celíaca.
 * Mezclarlos haría que un borrado de etiquetas se llevara por delante un dato
 * de seguridad.
 *
 * Aditiva e idempotente. No-op en schemas sin `recipes`.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-recetas-clasificacion.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-recetas-clasificacion.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function listSchemas(s) {
  const [rows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.schema_name));
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

const COLUMNAS = [
  // De dónde salió la receta, si vino de fuera. Se añadió el 04/08/2026 tras
  // tropezar: el importador de Harbiz deduplicaba por NOMBRE y se dejó 74
  // recetas fuera, porque Laura tiene 59 nombres repetidos que NO son
  // duplicados —«Huevos rellenos» existe dos veces, una escrita a mano y otra
  // con 10 ingredientes—. El nombre no identifica una receta; su id de origen sí.
  ["external_id", "VARCHAR(120)"],
  ["recipe_type", "VARCHAR(40)"],
  ["tags", "TEXT[] NOT NULL DEFAULT '{}'"],
  ["allergens", "TEXT[] NOT NULL DEFAULT '{}'"],
  ["dietary_preferences", "TEXT[] NOT NULL DEFAULT '{}'"],
  ["duration_minutes", "INTEGER"],
  ["rations", "INTEGER"],
];

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "recipes"))) {
    log(`· ${schema}: sin recetario, se salta`);
    return;
  }
  for (const [col, tipo] of COLUMNAS) {
    await s.query(`ALTER TABLE "${schema}"."recipes" ADD COLUMN IF NOT EXISTS ${col} ${tipo}`);
  }
  // Se filtra por tipo constantemente en la pantalla del recetario.
  await s.query(
    `CREATE INDEX IF NOT EXISTS "recipes_recipe_type_idx" ON "${schema}"."recipes" (recipe_type)`
  );
  // GIN: filtrar «que contenga esta etiqueta» sobre un array quiere GIN, no
  // btree. Con mil recetas y varias etiquetas cada una, se nota.
  await s.query(`CREATE INDEX IF NOT EXISTS "recipes_tags_idx" ON "${schema}"."recipes" USING GIN (tags)`);
  await s.query(`CREATE INDEX IF NOT EXISTS "recipes_allergens_idx" ON "${schema}"."recipes" USING GIN (allergens)`);
  // Único PARCIAL: dos recetas escritas a mano tienen las dos external_id NULL
  // y eso debe seguir permitido; lo que no puede repetirse es un id de origen.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "recipes_external_id_unique" ON "${schema}"."recipes" (external_id) WHERE external_id IS NOT NULL`
  );
  log(`✓ ${schema}: recetas clasificables (7 columnas + 4 índices)`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const schemas = await listSchemas(s);
    process.stdout.write(`\n▶ Clasificación de recetas · ${schemas.length} schema(s)\n\n`);
    for (const schema of schemas) await processSchema(s, schema);
    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
