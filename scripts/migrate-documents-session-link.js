/**
 * scripts/migrate-documents-session-link.js — `documents.clinic_session_id`
 * (02/09/2026, AV-0027 de Aumenta: «que todos los documentos que vayamos
 * subiendo respecto a las sesiones también salgan en el apartado de
 * Documentos, para una búsqueda más rápida»).
 *
 * Los adjuntos de PREPARACIÓN de una sesión clínica (`clinic_sessions.prep_files`)
 * pasan a tener su fila en `documents` (source `sesion_preparacion`) para que
 * el archivo central y la ficha del paciente los encuentren; esta columna dice
 * de qué sesión salen.
 *
 * CORE, como `migrate-documents-incidencia-link.js` (su hermana): la columna
 * vive en `documents` y el MODELO Document la declara para TODOS los tenants,
 * así que sin ella cualquier lectura del archivo central da 42703. Aditiva y
 * por existencia de la tabla `documents`; la FK a `clinic_sessions` solo donde
 * esa tabla existe, ON DELETE SET NULL: borrar la sesión no se lleva el
 * adjunto del archivo.
 *
 *   local:  node --env-file=.env.local scripts/migrate-documents-session-link.js
 *   VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documents-session-link.js
 *
 * Idempotente. Los adjuntos que YA existían se dan de alta aparte, con
 * `scripts/backfill-documents-preparacion.js` (datos: ensayo por defecto).
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

async function tablaExiste(s, schema, tabla) {
  const [[{ existe }]] = await s.query(`SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS existe`);
  return existe;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documento → sesión clínica (documents.clinic_session_id)\n");
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
      await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS clinic_session_id UUID`);
      await s.query(
        `CREATE INDEX IF NOT EXISTS documents_clinic_session_idx ON "${schema}"."documents" (clinic_session_id)`
      );
      if (await tablaExiste(s, schema, "clinic_sessions")) {
        await s.query(
          `DO $$ BEGIN
             ALTER TABLE "${schema}"."documents"
               ADD CONSTRAINT documents_clinic_session_id_fkey
               FOREIGN KEY (clinic_session_id) REFERENCES "${schema}"."clinic_sessions"(id) ON DELETE SET NULL;
           EXCEPTION
             WHEN duplicate_object THEN NULL;
             WHEN undefined_table  THEN NULL;
             WHEN undefined_column THEN NULL;
             -- Las fotos _golden de las demos son copias sin clave primaria:
             -- ahi no hay a que apuntar, y la columna ya esta.
             WHEN invalid_foreign_key THEN NULL;
           END $$;`
        );
        log(`✓ ${schema}: documents.clinic_session_id + FK a clinic_sessions listo`);
      } else {
        log(`✓ ${schema}: documents.clinic_session_id listo (sin clinic_sessions — sin FK)`);
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
