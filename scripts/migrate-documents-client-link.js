/**
 * migrate-documents-client-link.js
 *
 * Conecta los DOCUMENTOS con el cliente al que pertenecen.
 *
 * Hasta ahora un documento vivía solo dentro de una carpeta (folder_id) y
 * sabía quién lo subió (owner_user_id), pero NO a qué cliente correspondía.
 * Consecuencia: abrías la ficha de un cliente y no veías sus documentos; un
 * contrato flotaba en una carpeta sin dueño externo.
 *
 *   - documents.client_id UUID NULL, FK a clients(id) ON DELETE SET NULL.
 *     Nullable a propósito: hay documentos internos que no son de ningún
 *     cliente (plantillas, papeleo del equipo). SET NULL porque borrar una
 *     ficha no puede llevarse por delante sus documentos.
 *   - Índice por client_id (la ficha del cliente lista sus documentos).
 *
 * No hay relleno hacia atrás: un documento suelto no tiene ninguna pista
 * fiable de a qué cliente pertenece. Los que ya existen se quedan sin cliente
 * y se asignan a mano o al re-subirlos.
 *
 * Selecciona schemas por EXISTENCIA de tabla (scripts/_schema-targets.js).
 * Aditiva e idempotente. Transacción por schema.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-documents-client-link.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documents-client-link.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function addFk(s, schema, table, column, refTable, constraint, t) {
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."${table}"
         ADD CONSTRAINT ${constraint}
         FOREIGN KEY (${column}) REFERENCES "${schema}"."${refTable}"(id) ON DELETE SET NULL;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table  THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documentos enlazados con el cliente\n");
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
      const [[{ existe }]] = await s.query(
        `SELECT to_regclass('"${schema}"."clients"') IS NOT NULL AS existe`
      );
      if (!existe) { log(`· ${schema}: sin tabla clients, se salta`); continue; }

      await s.transaction(async (t) => {
        await s.query(
          `ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS client_id UUID`,
          { transaction: t }
        );
        await addFk(s, schema, "documents", "client_id", "clients", "documents_client_id_fkey", t);
        await s.query(
          `CREATE INDEX IF NOT EXISTS documents_client_idx ON "${schema}"."documents" (client_id)`,
          { transaction: t }
        );
      });
      log(`✓ ${schema}: documents.client_id listo`);
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
