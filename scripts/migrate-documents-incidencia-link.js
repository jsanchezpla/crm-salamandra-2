/**
 * migrate-documents-incidencia-link.js
 *
 * Enlaza cada documento del archivo central con la INCIDENCIA a la que se
 * adjuntó (documents.incidencia_id). Lo pidió Aumenta (26/08/2026): una
 * incidencia puede llevar documentos (un justificante, una foto, un informe), y
 * si además tiene paciente, ese documento se ve también desde su ficha
 * (documents.patient_id, que ya existía). Sin paciente, queda como documento
 * interno del archivo central.
 *
 *   - documents.incidencia_id UUID NULL (SIEMPRE que exista la tabla documents:
 *     el modelo lo referencia en todos esos tenants → si faltara, 42703).
 *   - FK a incidencias(id) ON DELETE SET NULL SOLO si existe la tabla
 *     incidencias (tenants con módulo Clínica/Pacientes). Borrar la incidencia
 *     NO borra sus documentos: pueden estar en la ficha de un paciente.
 *   - Índice por incidencia_id.
 *
 * Selecciona schemas por EXISTENCIA de tabla. Aditiva e idempotente.
 * Calcada de migrate-documents-patient-link.js, que es el mismo caso.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-documents-incidencia-link.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documents-incidencia-link.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function tablaExiste(s, schema, tabla) {
  const [[{ existe }]] = await s.query(
    `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS existe`
  );
  return existe;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documento → incidencia (documents.incidencia_id)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "documents");
  if (schemas.length === 0) log("· Ningún schema con tabla documents.");

  for (const schema of schemas) {
    try {
      // La COLUMNA se añade SIEMPRE (el modelo la referencia en todo tenant con
      // documents). La FK solo si existe incidencias en este schema.
      await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS incidencia_id UUID`);
      await s.query(
        `CREATE INDEX IF NOT EXISTS documents_incidencia_idx ON "${schema}"."documents" (incidencia_id)`
      );
      if (await tablaExiste(s, schema, "incidencias")) {
        await s.query(
          `DO $$ BEGIN
             ALTER TABLE "${schema}"."documents"
               ADD CONSTRAINT documents_incidencia_id_fkey
               FOREIGN KEY (incidencia_id) REFERENCES "${schema}"."incidencias"(id) ON DELETE SET NULL;
           EXCEPTION
             WHEN duplicate_object THEN NULL;
             WHEN undefined_table  THEN NULL;
             WHEN undefined_column THEN NULL;
           END $$;`
        );
        log(`✓ ${schema}: documents.incidencia_id + FK a incidencias listo`);
      } else {
        log(`✓ ${schema}: documents.incidencia_id listo (sin incidencias — sin FK)`);
      }
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
