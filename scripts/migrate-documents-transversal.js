/**
 * migrate-documents-transversal.js
 *
 * Convierte `documents` en el ARCHIVO CENTRAL del CRM (2026-07-23).
 *
 * Antes la tabla existía SOLO en los tenants con el módulo Documents, y solo
 * aceptaba PDF/DOCX/XLSX. La visión (Rodrigo): un archivo único y transversal
 * donde cualquier módulo sube (una nota de cliente, la ficha, en el futuro una
 * factura), y el módulo Documents es solo el buscador. Para subir NO hace falta
 * tener el módulo activo.
 *
 * Qué hace, en todo tenant que tenga tabla `clients` (byTable):
 *   1. Asegura los enums y las tablas document_folders / documents (crea las
 *      que falten — p. ej. en nutri_laura, que no tenía el módulo).
 *   2. Añade `client_id` (FK a clients ON DELETE SET NULL) y `source`
 *      (VARCHAR, de dónde vino) si faltan.
 *   3. RELAJA el tipo de fichero: ensancha mime_type a VARCHAR(150) y ELIMINA
 *      el CHECK que limitaba a PDF/DOCX/XLSX. Un archivo central que rechaza
 *      una foto no es un archivo central.
 *
 * Reemplaza a la parte estructural de migrate-documents-sprint-1 para el resto
 * de tenants (sprint-1 solo tocaba los del módulo). Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-documents-transversal.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documents-transversal.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function existeTabla(s, schema, tabla, t) {
  const [[{ hay }]] = await s.query(
    `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS hay`,
    { transaction: t }
  );
  return hay;
}

async function ensureEnum(s, schema, nombre, valores, t) {
  const lista = valores.map((v) => `'${v}'`).join(", ");
  await s.query(
    `DO $$ BEGIN
       CREATE TYPE "${schema}"."${nombre}" AS ENUM (${lista});
     EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    { transaction: t }
  );
}

async function crearFolders(s, schema, t) {
  await s.query(
    `CREATE TABLE "${schema}"."document_folders" (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       parent_folder_id UUID REFERENCES "${schema}"."document_folders"(id) ON DELETE CASCADE,
       visibility "${schema}"."enum_document_folders_visibility" NOT NULL,
       owner_user_id UUID NOT NULL,
       name VARCHAR(255) NOT NULL,
       level INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT document_folders_level_chk CHECK (level >= 0 AND level <= 3)
     )`,
    { transaction: t }
  );
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_root_dedup_idx"
       ON "${schema}"."document_folders"(name, visibility, owner_user_id)
       WHERE parent_folder_id IS NULL`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "document_folders_parent_idx"
       ON "${schema}"."document_folders"(parent_folder_id)`,
    { transaction: t }
  );
}

// documents ya nace transversal: mime libre, con client_id y source.
async function crearDocuments(s, schema, t) {
  await s.query(
    `CREATE TABLE "${schema}"."documents" (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       folder_id UUID REFERENCES "${schema}"."document_folders"(id) ON DELETE CASCADE,
       visibility "${schema}"."enum_documents_visibility" NOT NULL,
       owner_user_id UUID NOT NULL,
       file_name VARCHAR(255) NOT NULL,
       storage_path VARCHAR(500) NOT NULL,
       file_size BIGINT NOT NULL,
       mime_type VARCHAR(150) NOT NULL,
       client_id UUID REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL,
       source VARCHAR(40) NOT NULL DEFAULT 'manual',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT documents_file_size_chk CHECK (file_size >= 0)
     )`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "documents_owner_vis_idx" ON "${schema}"."documents"(owner_user_id, visibility)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "documents_folder_idx" ON "${schema}"."documents"(folder_id)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "documents_client_idx" ON "${schema}"."documents"(client_id)`,
    { transaction: t }
  );
}

async function adaptarDocuments(s, schema, t) {
  // Columnas nuevas.
  await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS client_id UUID`, { transaction: t });
  await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'manual'`, { transaction: t });
  // FK de client_id (idempotente).
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."documents"
         ADD CONSTRAINT documents_client_id_fkey
         FOREIGN KEY (client_id) REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL;
     EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;`,
    { transaction: t }
  );
  await s.query(`CREATE INDEX IF NOT EXISTS "documents_client_idx" ON "${schema}"."documents"(client_id)`, { transaction: t });
  // Ensanchar mime_type y ELIMINAR el CHECK que limitaba los tipos.
  await s.query(`ALTER TABLE "${schema}"."documents" ALTER COLUMN mime_type TYPE VARCHAR(150)`, { transaction: t });
  await s.query(`ALTER TABLE "${schema}"."documents" DROP CONSTRAINT IF EXISTS documents_mime_type_chk`, { transaction: t });
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documents como archivo central transversal\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // ARREGLO 2026-07-23 (revision de bugs): procesar todo schema que tenga
  // `clients` O `documents`. Antes solo miraba `clients`, asi que un tenant con
  // modulo documents SIN clients se quedaba sin la columna `source` (que el
  // modelo Document referencia siempre) → 42703. La columna source es
  // inofensiva y debe existir en todo tenant con `documents`.
  const conClients = (await byTable(s, "clients")).schemas;
  const conDocs = (await byTable(s, "documents")).schemas;
  const schemas = [...new Set([...conClients, ...conDocs])].sort();
  if (schemas.length === 0) log("· Ningún schema con clients ni documents.");

  for (const schema of schemas) {
    try {
      await s.transaction(async (t) => {
        await ensureEnum(s, schema, "enum_document_folders_visibility", ["private", "shared"], t);
        await ensureEnum(s, schema, "enum_documents_visibility", ["private", "shared"], t);

        if (!(await existeTabla(s, schema, "document_folders", t))) {
          await crearFolders(s, schema, t);
        }
        if (await existeTabla(s, schema, "documents", t)) {
          await adaptarDocuments(s, schema, t);
        } else {
          await crearDocuments(s, schema, t);
        }
      });
      log(`✓ ${schema}: documents transversal listo`);
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
