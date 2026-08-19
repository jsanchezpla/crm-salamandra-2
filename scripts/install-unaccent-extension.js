// @vivo — Hace falta para levantar un ENTORNO NUEVO: crea la extensión unaccent a nivel de base de datos (una vez por base, no por tenant), y… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * install-unaccent-extension.js
 *
 * Sprint nutri-laura Recetario — Checkpoint C3.
 *
 * Habilita la extensión `unaccent` de PostgreSQL en la base de datos
 * principal (la extensión es a nivel de BD, no de schema), para que la
 * búsqueda de alimentos del catálogo (`GET /api/nutricion/foods?q=...`)
 * pueda comparar nombres ignorando tildes / mayúsculas (`unaccent(LOWER(name))`).
 *
 * Idempotente — `CREATE EXTENSION IF NOT EXISTS` no falla si ya está
 * instalada. Requiere que el usuario de la BD tenga permisos de superuser
 * o que la extensión esté en `pg_available_extensions` y permitida por
 * el rol.
 *
 * Uso local:  node --env-file=.env.local scripts/install-unaccent-extension.js
 * Uso VPS:    docker exec -it crm-salamandra-app-1 node scripts/install-unaccent-extension.js
 */

import { Sequelize } from "sequelize";

const log = (msg) => process.stdout.write(`  ${msg}\n`);

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("✗ DATABASE_URL no definido en el entorno\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(url, {
    dialect: "postgres",
    logging: false,
  });

  try {
    await sequelize.authenticate();
    log("✓ Conectado a PostgreSQL");

    const [pre] = await sequelize.query(
      "SELECT 1 FROM pg_extension WHERE extname='unaccent' LIMIT 1"
    );
    if (pre.length > 0) {
      log("✓ La extensión 'unaccent' ya estaba instalada — nada que hacer");
      return;
    }

    log("▶ Creando extensión 'unaccent' (CREATE EXTENSION IF NOT EXISTS)…");
    await sequelize.query("CREATE EXTENSION IF NOT EXISTS unaccent");

    const [post] = await sequelize.query(
      "SELECT 1 FROM pg_extension WHERE extname='unaccent' LIMIT 1"
    );
    if (post.length === 0) {
      throw new Error(
        "La extensión no aparece tras CREATE EXTENSION — ¿permisos insuficientes del rol?"
      );
    }

    // Smoke quick: ¿funciona unaccent('Cebáda')?
    const [test] = await sequelize.query("SELECT unaccent('Cebáda Mañanéra') AS r");
    log(`✓ Extensión instalada — unaccent('Cebáda Mañanéra') = '${test[0].r}'`);
  } catch (err) {
    process.stderr.write(`✗ Error: ${err.message}\n`);
    process.exit(2);
  } finally {
    await sequelize.close();
  }
}

run();
