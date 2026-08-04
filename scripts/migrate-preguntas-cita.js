/**
 * migrate-preguntas-cita.js
 *
 * Preguntas propias de un tipo de cita, sin pasar por el módulo Formularios.
 *
 * Durante unas horas esto fue un `form_id` que apuntaba a un formulario del
 * módulo Formularios (commit ac66c2a). Obligaba a salir de la pantalla, crear
 * un formulario completo con su página pública y volver a engancharlo para
 * acabar preguntando dos cosas — y sin ese módulo contratado no había forma de
 * pedir un dato al reservar. Rodrigo lo revisó el 04/08/2026 y las preguntas
 * pasan a vivir en el propio tipo de cita.
 *
 * Qué hace:
 *   `event_types.form_questions` JSONB NOT NULL DEFAULT '[]'. Cada pregunta es
 *   `{ id, label, type, required }` con `type` ∈ numero | escala | corto |
 *   largo (ver `lib/citas/preguntasCita.js`).
 *
 * `form_id` NO se borra: la columna se queda vacía y sin usar. Tirar una
 * columna es irreversible y aquí no aporta nada — en producción no había ni un
 * solo tipo de cita que la usara (comprobado el 04/08/2026 antes de sustituirla).
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-preguntas-cita.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-preguntas-cita.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function ampliar(s, schema, t) {
  await s.query(
    `ALTER TABLE "${schema}"."event_types"
       ADD COLUMN IF NOT EXISTS form_questions JSONB NOT NULL DEFAULT '[]'::jsonb`,
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
  process.stdout.write(" Preguntas propias del tipo de cita\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `event_types`");
  const { schemas } = await byTable(s, "event_types");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await ampliar(s, schema, t); });
      log(`✓ ${schema}: preguntas disponibles`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write(" Ningún tipo de cita queda con preguntas: se añaden a mano.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
