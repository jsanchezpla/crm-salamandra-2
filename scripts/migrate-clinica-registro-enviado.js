/**
 * migrate-clinica-registro-enviado.js — el registro de sesión que YA se envió.
 *
 * Añade a `clinic_sessions`, en cada schema con `clinica` o `pacientes`:
 *   - `delivered_document_id` UUID NULL: el PDF publicado en el área privada.
 *   - `delivered_at` TIMESTAMPTZ NULL: cuándo se envió por primera vez.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * Lo pidió Aumenta (29/08/2026, por Rodrigo): poder subir un registro suelto al
 * área privada de la familia, sin tener que redactar un informe para ello.
 *
 * Las dos columnas son las mismas que ya tiene `clinical_reports` y por el
 * mismo motivo: sin guardar QUÉ documento se publicó, reenviar no puede borrar
 * el anterior y la familia acabaría con dos PDF del mismo día sin saber cuál
 * vale. `delivered_at` es solo para poder decirlo en pantalla.
 *
 * SIN FK a `documents` a propósito: borrar el documento desde el archivo no
 * debe borrar la sesión. El puntero se queda colgando y la pantalla vuelve a
 * ofrecer «Enviar», que es el comportamiento correcto.
 *
 * Sin backfill: nadie ha enviado un registro todavía, porque no se podía.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Los schemas salen de `byModule`
 * (`scripts/_schema-targets.js`), que arrastra también las FOTOS DORADAS de las
 * demos: si se quedan atrás, el día que una demo se restaure desde su foto
 * volvería sin las columnas y cada lectura de sesión daría 42703, porque el
 * modelo las declara. (Lección del 29/08/2026: las dos migraciones de esa
 * mañana nacieron con ese fallo y hubo que corregirlas.)
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-clinica-registro-enviado.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-clinica-registro-enviado.js
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
  if (!(await tableExists(s, schema, "clinic_sessions"))) {
    log(`✗ ${schema}: no existe clinic_sessions. Se salta.`);
    return;
  }
  await s.query(
    `ALTER TABLE "${schema}"."clinic_sessions"
       ADD COLUMN IF NOT EXISTS delivered_document_id UUID,
       ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`
  );
  log(`✓ ${schema}.clinic_sessions: delivered_document_id y delivered_at aseguradas`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el registro de sesión enviado a la familia\n");
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
