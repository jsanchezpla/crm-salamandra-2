/**
 * migrate-patients-specialties.js
 *
 * Añade a cada PACIENTE la lista de especialidades a las que pertenece
 * (Nutrición, Logopedia, Terapia ocupacional…). Es un array porque un paciente
 * puede necesitar varias (p. ej. logopedia + atención temprana).
 *
 *   - patients.specialties JSONB NOT NULL DEFAULT '[]'.
 *   - Backfill suave: los pacientes que ya eran de nutrición (care_type)
 *     arrancan con ['nutricion']; los de terapia se dejan vacíos (no se sabe la
 *     disciplina concreta) para que la nutricionista/el admin la rellene.
 *
 * El modelo Sequelize referencia specialties en TODOS los tenants con tabla
 * patients, por eso la columna se añade SIEMPRE (si faltara → 42703).
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-patients-specialties.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-patients-specialties.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: paciente → especialidades (specialties)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "patients");
  if (schemas.length === 0) log("· Ningún schema con tabla patients.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."patients"
           ADD COLUMN IF NOT EXISTS specialties JSONB NOT NULL DEFAULT '[]'::jsonb`
      );
      // Backfill sólo de los de nutrición inequívocos, y sólo si aún vacíos.
      // (care_type existe desde la migración anterior; si no, el UPDATE no casa.)
      await s.query(
        `UPDATE "${schema}"."patients"
            SET specialties = '["nutricion"]'::jsonb
          WHERE care_type = 'nutricion' AND specialties = '[]'::jsonb`
      ).catch(() => {});
      log(`✓ ${schema}: patients.specialties listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
