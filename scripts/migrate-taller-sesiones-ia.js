/**
 * migrate-taller-sesiones-ia.js — el audio y la IA en la sesión de TALLER
 * (03/09/2026, Rodrigo: «añade audio e IA a la sesión de taller»).
 *
 * Dos columnas en `taller_sesiones`, las mismas que ya tiene `clinic_sessions`:
 *   · `ai_transcription` TEXT    — de qué texto salió el registro (la
 *                                  transcripción del audio, las notas, o las dos)
 *   · `audio_duration_sec` INT   — lo que midió Whisper; null sin audio
 *
 * Sin backfill: nacen a NULL, que es «esto se escribió a mano».
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * El modelo `TallerSesion` declara las dos columnas y Sequelize las pide por
 * nombre en cada SELECT: sin ellas, abrir cualquier sesión de taller (y la
 * agenda de un taller) da 42703. Misma lección que `migrate-taller-sesiones`.
 *
 * Idempotente (IF NOT EXISTS). Los schemas salen de `byTable`, no de `byModule`:
 * la columna hace falta donde EXISTA la tabla —tenga el tenant el módulo activo
 * o no—, y `byTable` arrastra además las fotos doradas de las demos.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-taller-sesiones-ia.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-taller-sesiones-ia.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."taller_sesiones" ADD COLUMN IF NOT EXISTS ai_transcription TEXT`);
  await s.query(`ALTER TABLE "${schema}"."taller_sesiones" ADD COLUMN IF NOT EXISTS audio_duration_sec INTEGER`);
  log(`✓ ${schema}.taller_sesiones: ai_transcription y audio_duration_sec aseguradas`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: audio e IA en la sesión de taller\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "taller_sesiones");
  if (skipped?.length) log(`· sin taller_sesiones (se saltan): ${skipped.join(", ")}`);
  if (schemas.length === 0) {
    log("· Ningún schema con taller_sesiones.");
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
