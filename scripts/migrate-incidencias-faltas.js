/**
 * migrate-incidencias-faltas.js — la FALTA dentro de una incidencia
 * (03/09/2026, Rodrigo por AV-0038 de Aumenta).
 *
 * Añade a `incidencias`, en cada schema que tenga la tabla (fotos doradas de
 * las demos incluidas, por `byTable`):
 *   - `falta` JSONB, NULL en las incidencias de siempre; en las que abre sola
 *     la agenda al marcar una falta lleva { justificada, bookingId,
 *     huecosOfrecidos, respuesta, fechaRecuperacion, nota } (lib/clinica/faltas.js).
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Las incidencias automáticas por falta se mezclaban con las demás. Olga
 * pedía verlas aparte y llevar su ciclo (huecos ofrecidos, aceptada o
 * rechazada, cuándo se recupera). Con la columna, la pestaña «Faltas» de
 * Incidencias las enseña solas y las de siempre dejan de verlas.
 *
 * Backfill: las incidencias automáticas ANTERIORES a la columna se reconocen
 * por el título que escribió `textoIncidenciaFalta` («Falta justificada · …»
 * / «Falta injustificada · …») y entran en la pestaña sin respuesta apuntada;
 * su estado no se toca.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS + backfill con WHERE falta IS NULL).
 * Por existencia de tabla, sin mirar módulos (regla #12): el modelo declara la
 * columna para todos los tenants y sin ella el primer SELECT daría 42703.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-incidencias-faltas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-incidencias-faltas.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.transaction(async (t) => {
    await s.query(`ALTER TABLE "${schema}"."incidencias" ADD COLUMN IF NOT EXISTS falta JSONB`, { transaction: t });

    // El backfill escribe el MISMO objeto que `faltaDesdeTitulo`
    // (lib/clinica/faltas.js): justificada según el título, sin respuesta.
    const [, meta] = await s.query(
      `UPDATE "${schema}"."incidencias"
         SET falta = jsonb_build_object(
           'justificada', (title LIKE 'Falta justificada · %'),
           'bookingId', NULL,
           'huecosOfrecidos', '',
           'respuesta', 'pendiente',
           'fechaRecuperacion', NULL,
           'nota', ''
         )
       WHERE falta IS NULL
         AND (title LIKE 'Falta justificada · %' OR title LIKE 'Falta injustificada · %')`,
      { transaction: t }
    );
    log(`✓ ${schema}: columna falta asegurada · ${meta?.rowCount ?? 0} automática(s) de antes reconocidas como faltas`);
  });

  // Comprobación real, no la fe en el ALTER.
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = :schema AND table_name = 'incidencias' AND column_name = 'falta'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna falta NO está`);
}

async function main() {
  process.stdout.write("\n▶ Migración: la falta dentro de la incidencia (pestaña Faltas)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "incidencias");
  if (skipped.length) log(`· sin tabla incidencias, se saltan: ${skipped.join(", ")}`);
  for (const schema of schemas) await processSchema(s, schema);
  process.stdout.write(`\n✓ Hecho: ${schemas.length} schema(s)\n\n`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
