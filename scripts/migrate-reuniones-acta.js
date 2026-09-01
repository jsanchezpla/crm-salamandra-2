/**
 * migrate-reuniones-acta.js — el ACTA de una reunión de equipo.
 *
 * Añade a `team_blocks`, en TODO schema que tenga esa tabla:
 *   - `acta_sections`   JSONB NULL — el acta escrita (apartados + valores).
 *   - `acta_transcript` TEXT  NULL — de qué texto salió (audio y/o notas).
 *   - `acta_updated_at` TIMESTAMPTZ NULL — cuándo se escribió por última vez.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (01/09/2026, por Rodrigo): «implantar una plantilla para
 * actas de reunión para que las haga directamente el CRM a través de un audio o
 * unas notas que le suba, como los registros de sesión. Esas actas de reunión
 * son para la categoría de Reunión de equipo».
 *
 * Hoy una reunión de equipo es una hora tachada en la agenda y nada más: lo que
 * se acordó vive en la cabeza de quien estuvo. Con esto la reunión guarda su
 * acta, y el acta la escribe el CRM del audio, que es la diferencia entre que
 * se haga y que no se haga.
 *
 * El acta va en columnas de `team_blocks` y no en una tabla aparte porque es de
 * UNA reunión y una reunión ya es esa fila: uno a uno, sin segunda acta
 * posible. El porqué entero, en `lib/reuniones/acta.js`.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * El MODELO `TeamBlock` declara las tres columnas, así que Sequelize las pide
 * por nombre en CADA select de bloqueos: sin ellas, la agenda entera y la
 * pantalla de Bloqueos dan 42703. Misma lección que
 * `migrate-citas-categorias-bloqueo` el mismo día.
 *
 * ── POR QUÉ `byTable` Y NO `byModule` ───────────────────────────────────────
 * Porque el modelo declara las columnas para TODOS los tenants, no solo para
 * los que tienen Citas activo. `team_blocks` existe en siete schemas que
 * tuvieron el módulo y ya no lo tienen —y en las fotos doradas de las demos—, y
 * dejarlos fuera es lo que costó un arreglo el 01/09/2026: el módulo dice quién
 * puede ENTRAR, no qué forma tiene el schema (regla 12 de CLAUDE.md). Con las
 * fotos doradas dentro, restaurar una demo no la devuelve sin columnas.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS), aditiva, sin backfill y NULL por
 * defecto: los bloqueos que ya existen se comportan exactamente igual que ayer.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-reuniones-acta.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-reuniones-acta.js
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
       ADD COLUMN IF NOT EXISTS acta_sections JSONB,
       ADD COLUMN IF NOT EXISTS acta_transcript TEXT,
       ADD COLUMN IF NOT EXISTS acta_updated_at TIMESTAMPTZ`
  );
  log(`✓ ${schema}.team_blocks: acta_sections, acta_transcript y acta_updated_at aseguradas`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: acta de las reuniones de equipo\n");
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
