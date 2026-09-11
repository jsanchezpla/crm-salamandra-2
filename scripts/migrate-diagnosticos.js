/**
 * migrate-diagnosticos.js — el apartado DIAGNÓSTICO de Clínica: el expediente
 * de diagnóstico de un paciente y sus enganches en la agenda, las sesiones y
 * los bonos (12/09/2026, Rodrigo con Isa, Aumenta).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * Un diagnóstico es un producto cerrado de horas (simple: 10 h = 1 de
 * entrevista + 9; completo: 20 h = 1 + 19) con un terapeuta asignado y una
 * barra de horas que se CALCULA desde las citas. Tras la entrevista inicial,
 * o se para (cobro pendiente de la entrevista) o se sigue (un bono SIN TOPE
 * del tipo DIAGNÓSTICO con su cobro pendiente). El detalle, en
 * `lib/clinica/diagnostico.js` y en `docs/modules/clinica.md`.
 *
 * ── QUÉ TOCA, Y POR QUÉ EN CUATRO CONJUNTOS DE SCHEMAS ──────────────────────
 * Una tabla nueva donde hay `patients` (el expediente es de un paciente y
 * `patient_id` es NOT NULL; sin esa tabla no hay a quién abrírselo):
 *   · `diagnosticos`
 *
 * Y columnas en tablas que YA existen, cada una sobre los schemas que tengan
 * ESA tabla (regla 12 y la lección del 01/09/2026: la columna se migra por
 * dónde existe la TABLA, no por quién tiene el módulo — el modelo la declara
 * para todos y el ORM la pide en cada SELECT):
 *   · `bookings.diagnostico_id`, `.diagnostico_tramo`   ← módulo Citas
 *   · `clinic_sessions.diagnostico_id`                  ← Clínica / Pacientes
 *   · `session_packs.diagnostico_id`                    ← módulo Citas
 *   · `session_packs.total_sessions` deja de ser NOT NULL: NULL = SIN TOPE, el
 *     bono del diagnóstico, cuyas horas las acota el expediente y no un
 *     contador de sesiones (`lib/citas/packs.js`, `estadoPack`).
 *
 * Hay tenants con Citas y sin Clínica (nutri_laura) y `Booking`/`SessionPack`
 * declaran esas columnas para todos: sin ellas, cada lectura de su agenda o de
 * sus bonos daría 42703. Por eso está en los bloques `clinica`, `citas` y
 * `pacientes` de `_module-migrations.js` (el analizador deduplica).
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Por lo mismo de siempre: los modelos ya piden estas columnas por nombre.
 *
 * ── SIN FK DURAS, A PROPÓSITO (patrón `taller_grupo_id`) ────────────────────
 * El expediente apunta a ocho tablas de cuatro módulos, y hay schemas con unas
 * y sin otras: una FK de verdad no se podría crear en todos, y borrar un
 * concepto o un tipo de cita no puede llevarse el expediente de un niño.
 *
 * Idempotente (IF NOT EXISTS en todo; `DROP NOT NULL` sobre una columna que ya
 * lo admite no hace nada). Sin backfill: no hay expedientes que rellenar.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-diagnosticos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-diagnosticos.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function columnExists(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows.length > 0;
}

async function esNullable(s, schema, table, column) {
  const [rows] = await s.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column] }
  );
  return rows[0]?.is_nullable === "YES";
}

/** Comprobación real de que la columna está, no la fe en el ALTER. */
async function exige(s, schema, table, column) {
  if (!(await columnExists(s, schema, table, column))) {
    throw new Error(`${schema}.${table}: la columna ${column} NO está`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// La tabla nueva
// ───────────────────────────────────────────────────────────────────────────

async function creaTabla(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."diagnosticos" (
         id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         patient_id                UUID NOT NULL,
         client_id                 UUID,
         therapist_id              UUID,
         producto_key              VARCHAR(40) NOT NULL,
         producto_nombre           VARCHAR(120),
         horas_max                 NUMERIC(5,1) NOT NULL,
         horas_desbloqueadas_por   UUID,
         horas_desbloqueadas_at    TIMESTAMPTZ,
         event_type_id             UUID,
         concept_id                UUID,
         pack_id                   UUID,
         entrevista_booking_id     UUID,
         informe_id                UUID,
         status                    VARCHAR(20) NOT NULL DEFAULT 'entrevista',
         notes                     TEXT,
         created_by_id             UUID,
         created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      { transaction: t }
    );
    /*
     * `status` es VARCHAR con CHECK y no un ENUM de Postgres, a propósito: un
     * enum de verdad es propiedad del schema y obliga a un ALTER TYPE por cada
     * estado nuevo, que es lo que costó la migración del informe de beca
     * (26/08/2026). El modelo lo valida en Node (`ESTADOS` de
     * `lib/clinica/diagnostico.js`) y esto es el cinturón por debajo.
     */
    await s.query(
      `DO $$ BEGIN
         ALTER TABLE "${schema}"."diagnosticos"
           ADD CONSTRAINT diagnosticos_status_chk
           CHECK (status IN ('entrevista','no_continua','en_curso','cerrado'));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS diagnosticos_patient_idx ON "${schema}"."diagnosticos" (patient_id)`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS diagnosticos_status_idx ON "${schema}"."diagnosticos" (status)`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS diagnosticos_therapist_idx ON "${schema}"."diagnosticos" (therapist_id)`,
      { transaction: t }
    );
  });
  await exige(s, schema, "diagnosticos", "horas_max");
  log(`✓ ${schema}: diagnosticos`);
}

// ───────────────────────────────────────────────────────────────────────────
// Columnas en tablas que ya existían
// ───────────────────────────────────────────────────────────────────────────

async function columnasBookings(s, schema) {
  await s.transaction(async (t) => {
    await s.query(`ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS diagnostico_id UUID`, { transaction: t });
    await s.query(
      `ALTER TABLE "${schema}"."bookings" ADD COLUMN IF NOT EXISTS diagnostico_tramo VARCHAR(12)`,
      { transaction: t }
    );
    // «¿Qué citas tiene este expediente?» es la pregunta de la barra de horas,
    // y se hace en cada fila de la lista. Parcial: de las 12.030 citas de
    // Aumenta, las de diagnóstico serán unas decenas.
    await s.query(
      `CREATE INDEX IF NOT EXISTS bookings_diagnostico_idx
         ON "${schema}"."bookings" (diagnostico_id) WHERE diagnostico_id IS NOT NULL`,
      { transaction: t }
    );
  });
  await exige(s, schema, "bookings", "diagnostico_id");
  await exige(s, schema, "bookings", "diagnostico_tramo");
  log(`✓ ${schema}.bookings: diagnostico_id, diagnostico_tramo`);
}

async function columnaSesiones(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS diagnostico_id UUID`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS clinic_sessions_diagnostico_idx
         ON "${schema}"."clinic_sessions" (diagnostico_id) WHERE diagnostico_id IS NOT NULL`,
      { transaction: t }
    );
  });
  await exige(s, schema, "clinic_sessions", "diagnostico_id");
  log(`✓ ${schema}.clinic_sessions: diagnostico_id`);
}

async function columnasPacks(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."session_packs" ADD COLUMN IF NOT EXISTS diagnostico_id UUID`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS session_packs_diagnostico_idx
         ON "${schema}"."session_packs" (diagnostico_id) WHERE diagnostico_id IS NOT NULL`,
      { transaction: t }
    );
    // NULL = sin tope (el bono del diagnóstico). Los 237 bonos de Aumenta y
    // todos los demás siguen con su número: esto solo deja de prohibir el nulo.
    await s.query(
      `ALTER TABLE "${schema}"."session_packs" ALTER COLUMN total_sessions DROP NOT NULL`,
      { transaction: t }
    );
  });
  await exige(s, schema, "session_packs", "diagnostico_id");
  if (!(await esNullable(s, schema, "session_packs", "total_sessions"))) {
    throw new Error(`${schema}.session_packs: total_sessions sigue siendo NOT NULL`);
  }
  log(`✓ ${schema}.session_packs: diagnostico_id · total_sessions admite NULL (sin tope)`);
}

// ───────────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el apartado Diagnóstico de Clínica\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Cuatro conjuntos distintos, y la diferencia es justo la lección del
  // 01/09/2026: cada tabla se migra donde ESA tabla existe.
  const { schemas: conPatients } = await byTable(s, "patients");
  const { schemas: conBookings } = await byTable(s, "bookings");
  const { schemas: conSesiones } = await byTable(s, "clinic_sessions");
  const { schemas: conPacks } = await byTable(s, "session_packs");

  log(
    `✓ ${conPatients.length} con patients · ${conBookings.length} con bookings · ` +
      `${conSesiones.length} con clinic_sessions · ${conPacks.length} con session_packs`
  );

  for (const schema of conPatients) {
    header(schema);
    await creaTabla(s, schema);
  }
  for (const schema of conBookings) {
    header(`${schema} (agenda)`);
    await columnasBookings(s, schema);
  }
  for (const schema of conSesiones) {
    header(`${schema} (sesiones)`);
    await columnaSesiones(s, schema);
  }
  for (const schema of conPacks) {
    header(`${schema} (bonos)`);
    await columnasPacks(s, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
