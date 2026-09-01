/**
 * migrate-citas-bloqueo-taller.js — qué TALLER se da en un tramo bloqueado.
 *
 * Añade a `team_blocks`, en cada tenant con `citas` activo:
 *   - `taller_id` UUID NULL: el taller que se imparte en ese tramo.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * «Los talleres hay que ponerlos y dejarlos claros que ahora salen como
 * bloqueos y ya» (01/09/2026, Rodrigo). Era literal: HHSS, Grupo de Apoyo y
 * Mente Activa se apuntan en la agenda de Aumenta como un bloqueo con el nombre
 * escrito a mano. La hora queda tachada y nadie sabe —el CRM, digo— que ahí hay
 * un taller con ocho pacientes dentro. Con esta columna el bloqueo apunta al
 * taller de verdad, y desde él se registra la sesión del grupo.
 *
 * ── POR QUÉ VA EN `citas` Y NO CON EL RESTO DEL ENCARGO ────────────────────
 * Las otras dos piezas (`taller_sesiones` y `clinic_sessions.taller_sesion_id`)
 * están en `migrate-taller-sesiones.js`, en el bloque `clinica`. Esta no puede
 * ir ahí: `team_blocks` es del módulo `citas` y su MODELO declara `taller_id`
 * para todos los tenants, así que un centro con Citas y sin Clínica se quedaría
 * sin la columna y cada lectura de su agenda daría 42703. Es la misma regla que
 * la nota de CORE en `_module-migrations.js`.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Por lo mismo: el modelo la pide por nombre en cada SELECT de bloqueos.
 *
 * Sin backfill y sin FK dura. Nace a NULL —«este bloqueo no es un taller»—, que
 * es lo que son todos los que ya existen; y dar de baja un taller no puede
 * borrar las horas que ya estaban puestas en la agenda.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Los schemas salen de `byTable` y no de
 * `byModule`: la tabla existe en tenants que tuvieron Citas y ya no la tienen
 * activa, y el modelo pide la columna en todos ellos. Ver la cabecera de
 * `migrate-citas-categorias-bloqueo.js`, donde costó el arreglo.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-citas-bloqueo-taller.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-citas-bloqueo-taller.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

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
       ADD COLUMN IF NOT EXISTS taller_id UUID`
  );
  log(`✓ ${schema}.team_blocks: columna taller_id asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el taller que se da en un bloqueo\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(sequelize, "team_blocks");
  if (schemas.length === 0) {
    log("· Ningún schema con team_blocks.");
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
