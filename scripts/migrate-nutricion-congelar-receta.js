/**
 * migrate-nutricion-congelar-receta.js — la pauta entregada deja de moverse.
 *
 * ── EL PROBLEMA ─────────────────────────────────────────────────────────────
 * Al meter una receta en una pauta se congelaba MEDIA receta: nombre e
 * ingredientes se copiaban a `plan_meal_option_recipes` /
 * `plan_meal_option_recipe_foods`, pero los PASOS y la FOTO se leían en vivo de
 * `recipes` por `recipe_id` (lo decía la cabecera de lib/nutricion/menuPdf.js).
 *
 * Eso da lo peor de las dos opciones:
 *   · Corregir una cantidad mal puesta NO le llega a quien ya tiene la pauta
 *     —ni con «Re-aplicar menú origen», que recopia las copias viejas—.
 *   · Reescribir los pasos SÍ le cambia, sin avisar, pautas de hace meses.
 *
 * Decisión de producto (13/08/2026, Rodrigo): se congela TODO. Lo que se le
 * entrega a un paciente es un documento cerrado y no cambia solo. Para que una
 * corrección llegue hay una acción explícita —«Actualizar recetas»— que refresca
 * el snapshot de las pautas que se elijan.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 *   1. Añade `steps_snapshot` (JSONB, default '[]') y `photo_path_snapshot`
 *      (VARCHAR 500) a `plan_meal_option_recipes`.
 *   2. BACKFILL desde la receta viva: cada snapshot existente se rellena con lo
 *      que su receta dice HOY.
 *
 * El paso 2 es el que hace que esto no se note: hoy esas pautas ya enseñan los
 * pasos y la foto actuales, así que copiarlos deja la pantalla exactamente
 * igual el día del despliegue. Lo que cambia es el futuro — a partir de ahora se
 * quedan quietos. Sin backfill, todas las pautas vivas se quedarían sin pasos y
 * sin foto de golpe.
 *
 * Las filas cuya receta se borró (`recipe_id IS NULL`) se quedan con pasos
 * vacíos y sin foto, que es lo que ya enseñaban: el snapshot nunca los tuvo.
 *
 * Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-congelar-receta.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-congelar-receta.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const TABLA = "plan_meal_option_recipes";

async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = :table AND column_name = :column`,
    { replacements: { schema, table, column } }
  );
  return rows.length > 0;
}

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = :table`,
    { replacements: { schema, table } }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  const nuevas = [];

  if (!(await columnExists(s, schema, TABLA, "steps_snapshot"))) {
    await s.query(
      `ALTER TABLE "${schema}"."${TABLA}"
         ADD COLUMN steps_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb`
    );
    nuevas.push("steps_snapshot");
  }
  if (!(await columnExists(s, schema, TABLA, "photo_path_snapshot"))) {
    await s.query(
      `ALTER TABLE "${schema}"."${TABLA}"
         ADD COLUMN photo_path_snapshot VARCHAR(500)`
    );
    nuevas.push("photo_path_snapshot");
  }

  if (nuevas.length) log(`✓ ${schema}: columnas ${nuevas.join(", ")}`);

  // ── Backfill ──────────────────────────────────────────────────────────────
  // Solo las filas SIN rellenar, para que repetir la migración no pise un
  // snapshot que alguien haya congelado a propósito con otro contenido.
  // `recipes` puede no existir si el schema se quedó a medias: se comprueba.
  if (!(await tableExists(s, schema, "recipes"))) {
    log(`· ${schema}: sin tabla recipes, no hay de dónde rellenar. Se salta el backfill.`);
    return;
  }

  const [, meta] = await s.query(
    `UPDATE "${schema}"."${TABLA}" pmor
        SET steps_snapshot      = COALESCE(r.steps, '[]'::jsonb),
            photo_path_snapshot = r.photo_path,
            updated_at          = now()
       FROM "${schema}"."recipes" r
      WHERE r.id = pmor.recipe_id
        AND pmor.steps_snapshot = '[]'::jsonb
        AND pmor.photo_path_snapshot IS NULL`
  );
  const tocadas = meta?.rowCount ?? 0;
  if (tocadas > 0) log(`✓ ${schema}: ${tocadas} receta(s) de pauta rellenadas desde su receta viva`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — congelar pasos y foto en la pauta\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Aditiva: alcanza a todo schema que TENGA la tabla, tenga el módulo o no
  // (`sequelize.sync()` la crea en el alta de cualquier tenant).
  const { schemas } = await byTable(s, TABLA);
  if (schemas.length === 0) {
    log(`· Ningún schema con ${TABLA}.`);
    await s.close();
    process.exit(0);
  }

  for (const schema of schemas) {
    header(`Schema ${schema}`);
    try {
      await processSchema(s, schema);
      log(`✓ ${schema}: listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
