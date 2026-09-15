/**
 * migrate-pacientes-entrevista-no-necesaria.js — la entrevista inicial que no
 * hace falta.
 *
 * Añade a `patients`, en cada schema con `clinica` o `pacientes`:
 *   - `entrevista_no_necesaria` JSONB NULL: `{ at, byTeamMemberId, byUserId }`
 *     cuando alguien dijo que ese paciente no necesita entrevista inicial.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * AV-0141 (Aumenta, Daniela, 15/09/2026): la Bandeja reclama la entrevista
 * inicial a todo paciente nuevo que viene (lib/clinica/pendientesClinicos.js),
 * y hay pacientes que no la hacen. Sin un sitio donde decirlo, la tarea se
 * quedaba 30 días en la Bandeja sin forma de quitarla.
 *
 * JSONB y no un booleano: quién y cuándo es lo que se pregunta después. Sin
 * backfill ni valor por defecto (nace NULL = se reclama como hasta hoy).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Los schemas salen de `byModule`
 * (`scripts/_schema-targets.js`), que arrastra también las FOTOS DORADAS de las
 * demos. VA ANTES del despliegue: el MODELO Patient declara la columna y sin
 * ella cada lectura de pacientes da 42703.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-pacientes-entrevista-no-necesaria.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-pacientes-entrevista-no-necesaria.js
 */

import { Sequelize } from "sequelize";
import { byModule } from "./_schema-targets.js";

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
  if (!(await tableExists(s, schema, "patients"))) {
    log(`✗ ${schema}: no existe patients. Se salta.`);
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."patients" ADD COLUMN IF NOT EXISTS entrevista_no_necesaria JSONB`);
  log(`✓ ${schema}.patients: entrevista_no_necesaria asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: la entrevista inicial que no hace falta\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byModule(sequelize, ["clinica", "pacientes"]);
  if (schemas.length === 0) {
    log("· Ningún tenant con clinica/pacientes activo.");
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
