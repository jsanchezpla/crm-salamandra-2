/**
 * migrate-patients-care-type.js
 *
 * Añade a cada PACIENTE (subpaciente) el módulo asistencial al que pertenece:
 * Terapia (clínica/psico) o Nutrición. Hasta ahora la tabla `patients` era
 * exclusivamente terapéutica; un centro que ofrece los dos servicios (el
 * escaparate `demo` ya los tiene) necesita etiquetar a cada persona.
 *
 *   - patients.care_type VARCHAR(20) NOT NULL DEFAULT 'terapia'.
 *
 * Los pacientes existentes son todos terapéuticos (la tabla nació en el módulo
 * Clínica), así que el DEFAULT 'terapia' los deja bien clasificados sin relleno
 * aparte. El modelo Sequelize referencia esta columna en TODOS los tenants con
 * tabla patients, por eso se añade SIEMPRE (si faltara, un SELECT reventaría con
 * 42703).
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-patients-care-type.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-patients-care-type.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: paciente → módulo asistencial (care_type)\n");
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
      // NOT NULL DEFAULT 'terapia': rellena las filas existentes (todas
      // terapéuticas) de forma atómica. Idempotente: IF NOT EXISTS.
      await s.query(
        `ALTER TABLE "${schema}"."patients"
           ADD COLUMN IF NOT EXISTS care_type VARCHAR(20) NOT NULL DEFAULT 'terapia'`
      );
      log(`✓ ${schema}: patients.care_type listo`);
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
