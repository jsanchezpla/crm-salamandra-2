/**
 * migrate-event-types-informe.js — de qué cita sale qué informe
 * (`event_types.informe_tipo`, 09/09/2026).
 *
 * Aumenta: «no podemos crear las sesiones de Diagnóstico».
 *
 * El centro vende valoraciones diagnósticas —350 € la simple, 650 € la
 * completa, 40 facturas en lo que va de 2026— y desde el 05/09 el informe de
 * valoración diagnóstica existe con su guion de 25 apartados. Lo que no había
 * era la CITA: en la agenda solo estaban los ratos de «INFORME PARA
 * DIAGNOSTICO» (escribirlo), no la sesión de valoración con el niño, y nada
 * unía una cosa con la otra.
 *
 * Esta columna dice, para un tipo de cita, qué informe clínico sale de él. Con
 * ella, en la cita aparece el botón que abre ese informe del paciente ya
 * elegido, y quien valora no tiene que acordarse de cuál de los siete tipos
 * era. NULL —todos los tipos de hoy— = de esta cita no sale ningún informe:
 * exactamente lo de siempre.
 *
 * Es un puntero a `REPORT_TYPES` (`lib/clinica/serialize.js`), no una FK:
 * `clinical_reports` es del módulo Clínica y `event_types` del de Citas, y hay
 * schemas con la una y sin la otra.
 *
 * Solo ESTRUCTURA: una columna a NULL para todo lo que ya existe. Recorre los
 * schemas con `_schema-targets.js` (`byTable` sobre `event_types`), fotos
 * doradas incluidas. Idempotente. Correr ANTES de deploy.sh: el modelo la lee.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-event-types-informe.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-event-types-informe.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function processSchema(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."event_types" ADD COLUMN IF NOT EXISTS informe_tipo VARCHAR(32)`);
  const [col] = await s.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'event_types' AND column_name = 'informe_tipo'`,
    { replacements: { schema } }
  );
  if (!col.length) throw new Error(`${schema}: la columna informe_tipo NO está`);
  log(`✓ ${schema}: columna informe_tipo asegurada`);
}

async function main() {
  process.stdout.write("\n▶ Migración: de qué cita sale qué informe (event_types.informe_tipo)\n");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const { schemas, skipped } = await byTable(s, "event_types");
  for (const schema of skipped) log(`· ${schema}: sin event_types — se omite`);
  for (const schema of schemas) await processSchema(s, schema);
  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
