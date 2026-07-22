/**
 * migrate-nutricion-show-macros.js
 *
 * Petición de Rodrigo (2026-07-22): "Tiene que haber una posibilidad de
 * eliminar P H G FIBRA de todo. Ocultarlo en el menú de la paciente. No
 * olvides que está trabajando TCAs y muchos de ellos vienen de una relación
 * tóxica con los gramos de comida."
 *
 *   - plans.show_macros BOOLEAN NOT NULL DEFAULT false — si el PDF que recibe
 *     el paciente imprime proteínas / hidratos / grasas / fibra.
 *
 * DEFAULT false a propósito, y por eso los menús que ya existen se quedan
 * también en false: en una consulta que trata trastornos de la conducta
 * alimentaria, poner cifras delante del paciente tiene que ser una decisión
 * CONSCIENTE de la nutricionista, no lo que pasa si nadie toca nada. La
 * nutricionista sigue viendo todos los macros en el editor del CRM: el
 * interruptor solo gobierna el documento que sale a la calle.
 *
 * Selecciona schemas por EXISTENCIA de la tabla (scripts/_schema-targets.js).
 * Aditiva e idempotente. Transacción por schema.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-nutricion-show-macros.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-show-macros.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Nutrición — mostrar u ocultar macros\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Schemas con tabla `plans`...");
  const { schemas } = await byTable(s, "plans");
  if (schemas.length === 0) log("· Ninguno.");
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."plans"
             ADD COLUMN IF NOT EXISTS show_macros BOOLEAN NOT NULL DEFAULT false`,
          { transaction: t }
        );
      });
      log(`✓ ${schema}: plans.show_macros listo`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
