/**
 * migrate-documents-sprint-1.js
 *
 * Crea las tablas del módulo Documents (`document_folders`, `documents`) en los
 * tenants que tienen el módulo `documents` HABILITADO en master.tenant_modules.
 *
 * Patrón:
 *   - Lee los schemas en runtime con JOIN a tenant_modules.enabled=TRUE
 *     (regla #12; mismo fix que migrate-projects-sprint-1.js).
 *   - TRANSACCIÓN POR TENANT (no global): el fallo de un tenant NO revierte a
 *     los demás. Idempotente (IF NOT EXISTS + enums comprobados).
 *
 * Uso:
 *   npm run db:migrate:documents        (local)
 *   npm run db:migrate:documents:prod   (VPS: docker exec ... node scripts/migrate-documents-sprint-1.js)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function enumTypeExists(s, t, schema, typeName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = $1 AND ty.typname = $2`,
    { bind: [schema, typeName], transaction: t }
  );
  return rows.length > 0;
}

async function ensureEnum(s, t, schema, typeName, values) {
  if (await enumTypeExists(s, t, schema, typeName)) return "ya existía";
  const vals = values.map((v) => `'${v}'`).join(", ");
  await s.query(`CREATE TYPE "${schema}"."${typeName}" AS ENUM (${vals})`, { transaction: t });
  return "creado";
}

async function processSchemaInTx(s, t, schema) {
  const r = { tenant: schema.replace(/^crm_/, ""), enums: "—", folders: "—", documents: "—" };

  // 1) Enums (Sequelize los nombra enum_{tabla}_{columna}).
  // Visibility como enum nativo (labels cortas). mime_type NO es enum: los MIME
  // de DOCX/XLSX (72-73 chars) exceden el límite de 63 bytes de las etiquetas de
  // enum de Postgres → se guarda como VARCHAR con CHECK (ver tabla documents).
  await ensureEnum(s, t, schema, "enum_document_folders_visibility", ["private", "shared"]);
  await ensureEnum(s, t, schema, "enum_documents_visibility", ["private", "shared"]);
  r.enums = "ok";

  // 2) document_folders
  if (await tableExists(s, t, schema, "document_folders")) {
    r.folders = "ya existía";
  } else {
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
    r.folders = "creada";
  }
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_dedup_idx"
       ON "${schema}"."document_folders"(parent_folder_id, name, visibility, owner_user_id)`,
    { transaction: t }
  );
  // Índice parcial para la raíz: el UNIQUE de arriba trata los NULL como
  // distintos, así que sin esto dos carpetas raíz idénticas (parent NULL) del
  // mismo owner/visibility colarían en una carrera.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_root_dedup_idx"
       ON "${schema}"."document_folders"(name, visibility, owner_user_id)
       WHERE parent_folder_id IS NULL`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "document_folders_owner_vis_idx"
       ON "${schema}"."document_folders"(owner_user_id, visibility)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "document_folders_parent_idx"
       ON "${schema}"."document_folders"(parent_folder_id)`,
    { transaction: t }
  );

  // 3) documents
  if (await tableExists(s, t, schema, "documents")) {
    r.documents = "ya existía";
  } else {
    await s.query(
      `CREATE TABLE "${schema}"."documents" (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         folder_id UUID REFERENCES "${schema}"."document_folders"(id) ON DELETE CASCADE,
         visibility "${schema}"."enum_documents_visibility" NOT NULL,
         owner_user_id UUID NOT NULL,
         file_name VARCHAR(255) NOT NULL,
         storage_path VARCHAR(500) NOT NULL,
         file_size BIGINT NOT NULL,
         mime_type VARCHAR(100) NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CONSTRAINT documents_file_size_chk CHECK (file_size >= 0),
         CONSTRAINT documents_mime_type_chk CHECK (mime_type IN (
           'application/pdf',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
         ))
       )`,
      { transaction: t }
    );
    r.documents = "creada";
  }
  await s.query(
    `CREATE INDEX IF NOT EXISTS "documents_owner_vis_idx"
       ON "${schema}"."documents"(owner_user_id, visibility)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS "documents_folder_idx"
       ON "${schema}"."documents"(folder_id)`,
    { transaction: t }
  );

  return r;
}

async function fetchDocumentsTenantSlugs(s) {
  const [rows] = await s.query(`
    SELECT t.slug FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE tm.module_key = 'documents' AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((row) => row.slug));
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Documents Sprint 1                       \n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    const [ver] = await sequelize.query("SHOW server_version");
    log(`PostgreSQL: ${ver[0]?.server_version ?? "?"}`);

    header("Obteniendo tenants con módulo documents activo...");
    const slugs = await fetchDocumentsTenantSlugs(sequelize);
    if (slugs.length === 0) {
      log("· Ningún tenant con `documents` habilitado. Ejecuta antes enable-documents-all-tenants.js. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Aplicando migración (transacción POR TENANT)...");
    const results = [];
    for (const slug of slugs) {
      const schema = `crm_${slug}`;
      process.stdout.write(`\n· Schema ${schema}\n`);
      try {
        const r = await sequelize.transaction(async (t) => processSchemaInTx(sequelize, t, schema));
        log(`✓ ${schema}: folders=${r.folders} · documents=${r.documents}`);
        results.push({ ...r, status: "ok" });
      } catch (err) {
        log(`✗ ${schema}: ERROR — ${err.message} (los demás tenants continúan)`);
        results.push({ tenant: slug, status: "ERROR", error: err.message });
      }
    }

    process.stdout.write("\n┌──────────────┬──────────┬──────────────┬──────────────┐\n");
    process.stdout.write("│ tenant       │ estado   │ document_fol │ documents    │\n");
    process.stdout.write("├──────────────┼──────────┼──────────────┼──────────────┤\n");
    for (const r of results) {
      process.stdout.write(
        `│ ${String(r.tenant).padEnd(12)} │ ${String(r.status).padEnd(8)} │ ${String(r.folders ?? "—").padEnd(12)} │ ${String(r.documents ?? "—").padEnd(12)} │\n`
      );
    }
    process.stdout.write("└──────────────┴──────────┴──────────────┴──────────────┘\n");

    const failed = results.filter((r) => r.status === "ERROR").length;
    process.stdout.write(`\n${failed ? "⚠" : "✓"} Migración completada (${failed} con error)\n\n`);
    await sequelize.close();
    process.exit(failed ? 1 : 0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
