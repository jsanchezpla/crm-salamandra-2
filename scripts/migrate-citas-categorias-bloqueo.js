/**
 * migrate-citas-categorias-bloqueo.js — la CATEGORÍA de un bloqueo de agenda.
 *
 * Añade a `team_blocks`, en cada tenant con `citas` activo:
 *   - `category_key` VARCHAR(64) NULL: la clave de una de las categorías del
 *     centro (`settings.citas.categoriasBloqueo`).
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (01/09/2026, por Rodrigo): «dentro de bloqueos, poder hacer
 * categorías —reunión de equipo, trabajo interno, gestión documental,
 * valoraciones, libre de pacientes, descanso— con color personalizable desde
 * Admin para que a todo el equipo le salga igual».
 *
 * Un bloqueo ya tenía `label`, pero es texto libre: en producción «Reservado
 * T.I.» está escrito de tres formas distintas y `lib/clinica/trabajoInterno.js`
 * tiene que normalizar tildes y puntos para que el sumatorio de Productividad
 * no se parta en tres. La categoría se elige de una lista y se cuenta por su
 * clave. El porqué completo, en `lib/citas/categoriasBloqueo.js`.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * El MODELO declara `categoryKey`, así que Sequelize la pide por nombre en cada
 * SELECT de bloqueos: sin la columna, la agenda y la pantalla de Bloqueos dan
 * 42703. Misma lección que `migrate-clinica-apartados-sesion` (29/08/2026).
 *
 * Sin backfill y NULL por defecto, que es lo que la hace inofensiva: los
 * bloqueos que ya existen se quedan sin categoría y se leen, se pintan y se
 * cuentan exactamente igual que ayer. Nada cambia para nadie hasta que un
 * centro dé de alta sus categorías desde Configuración → Agenda.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Los schemas salen de `byModule`
 * (`scripts/_schema-targets.js`), que además de los tenants con el módulo
 * arrastra las FOTOS DORADAS de las demos: sin ellas, el día que una demo se
 * restaure desde su foto volvería sin la columna y cada lectura de la agenda
 * daría 42703 (lo cazó el propio despliegue el 29/08/2026).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-citas-categorias-bloqueo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-citas-categorias-bloqueo.js
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
  if (!(await tableExists(s, schema, "team_blocks"))) {
    log(`✗ ${schema}: no existe team_blocks. Se salta.`);
    return;
  }

  await s.query(
    `ALTER TABLE "${schema}"."team_blocks"
       ADD COLUMN IF NOT EXISTS category_key VARCHAR(64)`
  );
  log(`✓ ${schema}.team_blocks: columna category_key asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: categoría de los bloqueos de agenda\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byModule(sequelize, ["citas"]);
  if (schemas.length === 0) {
    log("· Ningún tenant con citas activo.");
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
