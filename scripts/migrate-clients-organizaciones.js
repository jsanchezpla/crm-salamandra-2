/**
 * migrate-clients-organizaciones.js
 *
 * Empresas y universidades con ficha propia (15/09/2026, Rodrigo; AV-0153 de
 * Aumenta). El porqué de cada columna, en `lib/clients/organizaciones.js`.
 *
 * Qué crea, en `clients`:
 *   · `tipo_ficha`             VARCHAR(20) — NULL (particular), 'empresa' o 'universidad'.
 *   · `es_alumno_practicas`    BOOLEAN NOT NULL DEFAULT false — la casilla.
 *   · `universidad_id`         UUID — la ficha de su universidad.
 *   · `empresa_id`             UUID — la ficha de la empresa por la que viene.
 *   · `pago_organizacion_pct`  NUMERIC(5,2) — cuánto de lo suyo paga esa organización.
 *
 * Texto y no ENUM en `tipo_ficha` a propósito: añadir un tipo mañana (un
 * colegio, una fundación) no tiene que pasar por un ALTER TYPE en 16 schemas.
 * Los vínculos van sin FK dura, como `payer_client_id` de las cuotas: borrar la
 * ficha de una universidad no puede arrastrar ni bloquear las de sus alumnos.
 *
 * Aditiva e idempotente. Ni un slug a mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clients-organizaciones.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clients-organizaciones.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function migrar(s, schema, t) {
  const q = (sql) => s.query(sql, { transaction: t });
  await q(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS tipo_ficha VARCHAR(20)`);
  await q(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS es_alumno_practicas BOOLEAN NOT NULL DEFAULT false`);
  await q(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS universidad_id UUID`);
  await q(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS empresa_id UUID`);
  await q(`ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS pago_organizacion_pct NUMERIC(5,2)`);
  // Parciales: las organizaciones y sus vinculados son una minoría de fichas.
  await q(`CREATE INDEX IF NOT EXISTS clients_tipo_ficha_idx ON "${schema}"."clients" (tipo_ficha) WHERE tipo_ficha IS NOT NULL`);
  await q(`CREATE INDEX IF NOT EXISTS clients_universidad_idx ON "${schema}"."clients" (universidad_id) WHERE universidad_id IS NOT NULL`);
  await q(`CREATE INDEX IF NOT EXISTS clients_empresa_idx ON "${schema}"."clients" (empresa_id) WHERE empresa_id IS NOT NULL`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ Falta DATABASE_URL\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Empresas y universidades con ficha propia\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Schemas con `clients`");
  const { schemas } = await byTable(s, "clients");
  if (schemas.length === 0) log("· Ninguno.");
  let fallos = 0;
  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => { await migrar(s, schema, t); });
      log(`✓ ${schema}: columnas listas`);
    } catch (err) {
      fallos++;
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(fallos ? ` ✗ ${fallos} schema(s) con error\n` : " ✓ Migración completada\n");
  process.stdout.write(" Ninguna ficha cambia de tipo: se marca desde la ficha.\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  if (fallos) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
