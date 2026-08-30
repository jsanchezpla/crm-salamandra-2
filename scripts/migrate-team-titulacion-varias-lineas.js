/**
 * migrate-team-titulacion-varias-lineas.js — la titulación deja de ser una línea.
 *
 * `team_members.qualification` pasa de `VARCHAR(120)` a `TEXT`, en cada tenant
 * con `clinica` o `pacientes` activo (y en las fotos doradas de las demos, que
 * van detrás de su vivo por `byModule`).
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * El campo nació el 28/08/2026 pensando en una línea: «Graduada en Logopedia».
 * Al día siguiente Aumenta mandó las titulaciones de sus 16 profesionales y
 * ninguna es una sola — la profesión, y debajo el máster, el postgrado y el
 * experto, hasta SEIS líneas en una persona. La más larga son 184 caracteres,
 * así que en 120 no cabe: se guardaría cortada por la mitad.
 *
 * A partir de aquí se guarda **un título por línea**. La primera acompaña al nº
 * de colegiada en el documento («Logopeda · Nº Col. 28/0256») y las demás van
 * debajo, una por renglón (`lib/clinica/firmaProfesional.js`).
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * Ensanchar un VARCHAR a TEXT en PostgreSQL **no reescribe la tabla ni toca
 * ninguna fila**: es un cambio de catálogo. Y no puede fallar por los datos,
 * porque todo lo que cabía en 120 cabe en TEXT. Aquí no se rellena nada: los
 * datos de cada centro los escribe su gente en Equipo → ficha del profesional.
 *
 * Idempotente: si la columna ya es TEXT, el ALTER no cambia nada.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-team-titulacion-varias-lineas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-team-titulacion-varias-lineas.js
 */

import { Sequelize } from "sequelize";
import { byModule } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tipoDe(s, schema) {
  const [rows] = await s.query(
    `SELECT data_type, character_maximum_length AS len
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'team_members' AND column_name = 'qualification'`,
    { bind: [schema] }
  );
  return rows[0] ?? null;
}

async function processSchema(s, schema) {
  const antes = await tipoDe(s, schema);
  if (!antes) {
    log(`✗ ${schema}: no existe team_members.qualification. Se salta.`);
    return;
  }
  if (antes.data_type === "text") {
    log(`· ${schema}: ya era TEXT, nada que hacer`);
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."team_members" ALTER COLUMN qualification TYPE TEXT`);
  log(`✓ ${schema}: qualification ${antes.data_type}(${antes.len}) → TEXT`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: la titulación admite varias líneas\n");
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
