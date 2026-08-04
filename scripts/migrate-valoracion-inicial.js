/**
 * migrate-valoracion-inicial.js
 *
 * Marca «esta es la valoración inicial» en un tipo de cita.
 *
 * A la valoración inicial se entra SIN firmar nada: es la primera visita,
 * cuando la persona todavía no ha decidido si empieza. Pedirle el contrato del
 * centro para conocer a la nutricionista espantaba gente en la puerta
 * (Rodrigo, 04/08/2026). El portal usa esta marca para ofrecer «¿entras a una
 * valoración inicial?» ANTES de los contratos.
 *
 * Qué hace:
 *   1. `event_types`: `is_initial_assessment` BOOLEAN NOT NULL DEFAULT false.
 *   2. Índice parcial ÚNICO: como mucho un tipo marcado por schema. Se hace en
 *      base de datos y no solo en el endpoint porque dos marcados dejarían al
 *      portal eligiendo uno al azar, y el fallo saldría meses después.
 *
 * NO marca nada por su cuenta: qué cita es la valoración lo decide el centro
 * desde Citas → Tipos de cita. Adivinarlo por el nombre acertaría hoy en
 * nutri_laura y se equivocaría en el siguiente.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-valoracion-inicial.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-valoracion-inicial.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function marcarValoracion(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."event_types"
       ADD COLUMN IF NOT EXISTS is_initial_assessment BOOLEAN NOT NULL DEFAULT false`,
    { transaction: t }
  );

  // Índice parcial: solo restringe a los marcados, así que los `false` (que son
  // todos menos uno) no se estorban entre sí.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS event_types_una_valoracion
       ON "${schema}"."event_types" ((is_initial_assessment))
       WHERE is_initial_assessment`,
    { transaction: t }
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ Falta DATABASE_URL\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Valoración inicial: marca en el tipo de cita\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `event_types`");
  const { schemas } = await byTable(s, "event_types");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await marcarValoracion(s, schema, t); });
      log(`✓ ${schema}: marca disponible`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write(" Ninguna cita queda marcada: se elige en Citas → Tipos de cita.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
