/**
 * migrate-citas-cobro-de-la-cita.js — el dinero al que va atada cada cita.
 *
 * Añade, en cada schema que tenga la tabla:
 *   - `event_types.concept_id` UUID NULL — el concepto del catálogo («la
 *     cuota») que cubre las citas de ese tipo. Se pone UNA vez por tipo y baja
 *     solo a cada cita nueva.
 *   - `bookings.cobro_modo` VARCHAR(16) NULL — `cuota` | `libre` | `sin_coste`.
 *   - `bookings.cobro_concept_id` UUID NULL — qué concepto la cubre.
 *   - `bookings.cobro_texto` VARCHAR(200) NULL — el nombre del concepto, el
 *     texto del cobro libre, o el MOTIVO cuando no se cobra.
 *   - `bookings.cobro_importe` INTEGER NULL — en céntimos, foto al crearla.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Rodrigo, 04/09/2026 (Aumenta): «para crear una cita tiene que estar asociada
 * a una cuota o a un cobro de texto libre, así cuando se crea una cita siempre
 * está aparejada a un dinero y se puede cobrar con comodidad y nunca se crean
 * citas gratuitas sin quererlo». La regla y los tres modos, en
 * `lib/citas/dineroDeLaCita.js`.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Los MODELOS `Booking` y `EventType` declaran estas columnas, así que
 * Sequelize las pide por nombre en cada SELECT de la agenda y del catálogo de
 * tipos: sin ellas, la agenda entera da 42703. Misma lección que
 * `migrate-citas-categorias-bloqueo` (01/09/2026).
 *
 * ── SIN BACKFILL, Y ESO ES LO QUE LA HACE INOFENSIVA ────────────────────────
 * Todo NULL: las 13.408 citas de Aumenta y las de todos los demás se quedan sin
 * cobro y se leen, se pintan y se cobran exactamente igual que ayer. Nada
 * cambia para nadie hasta que un centro rellene los conceptos de sus tipos y
 * encienda `settings.citas.cobroObligatorio` en Configuración → Citas.
 *
 * No hay FK a `billing_concepts` a propósito: hay schemas con `bookings` y sin
 * módulo de facturación (la tabla de conceptos ni existe), y una FK de verdad
 * no se podría ni crear. Es la misma decisión que `event_types.taller_grupo_id`.
 * Lo que se guarda además del id es el TEXTO, así que borrar un concepto no
 * deja la cita muda.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Los schemas salen de `byTable` y no
 * de `byModule`: el modelo se declara para todos, así que Sequelize pide las
 * columnas en cualquier schema que tenga la tabla — incluidas las FOTOS
 * DORADAS de las demos, que si no volverían sin ellas al restaurarse.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-citas-cobro-de-la-cita.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-citas-cobro-de-la-cita.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  if (await tableExists(s, schema, "event_types")) {
    await s.query(
      `ALTER TABLE "${schema}"."event_types"
         ADD COLUMN IF NOT EXISTS concept_id UUID`
    );
    log(`✓ ${schema}.event_types: columna concept_id asegurada`);
  } else {
    log(`· ${schema}: no existe event_types. Se salta.`);
  }

  if (await tableExists(s, schema, "bookings")) {
    await s.query(
      `ALTER TABLE "${schema}"."bookings"
         ADD COLUMN IF NOT EXISTS cobro_modo       VARCHAR(16),
         ADD COLUMN IF NOT EXISTS cobro_concept_id UUID,
         ADD COLUMN IF NOT EXISTS cobro_texto      VARCHAR(200),
         ADD COLUMN IF NOT EXISTS cobro_importe    INTEGER`
    );
    log(`✓ ${schema}.bookings: columnas de cobro aseguradas`);
  } else {
    log(`· ${schema}: no existe bookings. Se salta.`);
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el dinero al que va atada cada cita\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Los dos conjuntos, unidos: un schema puede tener `event_types` y no
  // `bookings` (o al revés) y cada bloque de arriba se protege solo.
  const { schemas: conTipos } = await byTable(sequelize, "event_types");
  const { schemas: conCitas } = await byTable(sequelize, "bookings");
  const schemas = [...new Set([...conTipos, ...conCitas])].sort();

  if (schemas.length === 0) {
    log("· Ningún schema con event_types ni bookings.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    await processSchema(sequelize, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
