/**
 * migrate-diagnosticos-2.js — la SEGUNDA entrega del apartado DIAGNÓSTICO:
 * los registros de diagnóstico por fecha y título, y el cobro de la
 * entrevista atado por id (12/09/2026, Rodrigo con Isa, Aumenta).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Informe de diagnóstico por paciente: entradas por fecha y título que al
 * final se unen con IA en el informe completo.» Las entradas son registros de
 * sesión de siempre (`clinic_sessions` con `diagnostico_id`, que existe desde
 * la primera entrega): lo único que les faltaba era el TÍTULO —«Sesión de
 * diagnóstico 3», «Pruebas WISC-V»—, que hasta hoy no cabía en ninguna
 * columna. Y el expediente sabía de su cobro de entrevista por nota + fecha
 * (`cobrosDeExpedientes`), que era lo apuntado como provisional: desde hoy lo
 * ata por id, y con el descuento de la entrevista (respuesta B de Aumenta) hace
 * falta saber SIN adivinar cuál es ese cobro.
 *
 * ── QUÉ TOCA, Y POR QUÉ EN DOS CONJUNTOS DE SCHEMAS ─────────────────────────
 * Dos columnas, cada una sobre los schemas que tengan ESA tabla (regla 12 y la
 * lección del 01/09/2026: la columna se migra por dónde existe la TABLA, no por
 * quién tiene el módulo — el modelo la declara para todos y el ORM la pide en
 * cada SELECT):
 *   · `clinic_sessions.titulo VARCHAR(160)`        ← Clínica / Pacientes
 *   · `diagnosticos.entrevista_payment_id UUID`     ← donde hay expedientes
 *
 * `clinic_sessions` existe con `pacientes` suelto, y `ClinicSession` declara
 * `titulo` para todos: por eso va en los bloques `clinica` y `pacientes` de
 * `_module-migrations.js` (el analizador deduplica). NO va en `citas`: ni
 * `bookings` ni `session_packs` cambian en esta entrega.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Por lo mismo de siempre: los modelos ya piden estas columnas por nombre.
 *
 * ── SIN FK, A PROPÓSITO (patrón `taller_grupo_id`) ──────────────────────────
 * `entrevista_payment_id` apunta a `payments`, y hay schemas con Clínica y sin
 * Facturación: la FK no se podría crear en todos, y anular un cobro no puede
 * llevarse el expediente de un niño. El puntero se queda colgando y la fila lo
 * enseña como «sin cobro».
 *
 * Idempotente (IF NOT EXISTS en todo). Sin backfill: los títulos los pondrá
 * quien escriba, y el cobro de los expedientes parados antes de hoy lo sigue
 * encontrando `cobrosDeExpedientes` por nota + fecha mientras no tengan id.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-diagnosticos-2.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-diagnosticos-2.js
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

/** Comprobación real de que la columna está, no la fe en el ALTER. */
async function exige(s, schema, table, column) {
  if (!(await columnExists(s, schema, table, column))) {
    throw new Error(`${schema}.${table}: la columna ${column} NO está`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Columnas en tablas que ya existían
// ───────────────────────────────────────────────────────────────────────────

async function columnaTitulo(s, schema) {
  await s.transaction(async (t) => {
    // 160 y no TEXT: es el título de una entrada de un índice («Sesión de
    // diagnóstico 3», «Pruebas WISC-V»), no un cuerpo. `MAX_TITULO` de
    // `lib/clinica/registroDeDiagnostico.js` es el mismo número.
    await s.query(
      `ALTER TABLE "${schema}"."clinic_sessions" ADD COLUMN IF NOT EXISTS titulo VARCHAR(160)`,
      { transaction: t }
    );
  });
  await exige(s, schema, "clinic_sessions", "titulo");
  log(`✓ ${schema}.clinic_sessions: titulo`);
}

async function columnaCobroEntrevista(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."diagnosticos" ADD COLUMN IF NOT EXISTS entrevista_payment_id UUID`,
      { transaction: t }
    );
  });
  await exige(s, schema, "diagnosticos", "entrevista_payment_id");
  log(`✓ ${schema}.diagnosticos: entrevista_payment_id`);
}

// ───────────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Diagnóstico, segunda entrega (registros e informe)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Dos conjuntos distintos: cada tabla se migra donde ESA tabla existe.
  const { schemas: conSesiones } = await byTable(s, "clinic_sessions");
  const { schemas: conDiagnosticos } = await byTable(s, "diagnosticos");

  log(`✓ ${conSesiones.length} con clinic_sessions · ${conDiagnosticos.length} con diagnosticos`);

  for (const schema of conSesiones) {
    header(`${schema} (sesiones)`);
    await columnaTitulo(s, schema);
  }
  for (const schema of conDiagnosticos) {
    header(`${schema} (expedientes)`);
    await columnaCobroEntrevista(s, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
