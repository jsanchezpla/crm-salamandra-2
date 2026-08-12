/**
 * migrate-client-attachments-and-notes.js
 *
 * Sprint Fase 1 nutri_laura — añade dos tablas al módulo clients:
 *   - client_attachments: archivos PDF adjuntos por cliente.
 *   - client_notes:        notas internas (timeline, distinto de Interaction).
 *
 * Multi-tenant:
 *   - Lee slugs activos desde master.tenants.
 *   - Solo afecta a tenants con el módulo `clients` habilitado en
 *     master.tenant_modules (enabled=true).
 *   - Idempotente: CREATE TABLE IF NOT EXISTS + índices IF NOT EXISTS.
 *
 * FKs físicas: ON DELETE CASCADE contra crm_{slug}.clients(id). Si un
 * cliente se borra, sus notas y attachments se borran en BD (los archivos
 * físicos en disco se limpian en el endpoint DELETE de cliente — fuera
 * del alcance de esta migración).
 *
 * Uso:
 *   npm run db:migrate:client-attachments       (local)
 *   npm run db:migrate:client-attachments:prod  (producción)
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers ────────────────────────────────────────────────────────────────

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName], transaction: t }
  );
  return rows.length > 0;
}

// ─── Crea tablas en una transacción por schema ──────────────────────────────

async function processSchemaInTx(s, t, schema) {
  // Pre-check: el tenant debe tener tabla `clients` (módulo clients instalado).
  if (!(await tableExists(s, t, schema, "clients"))) {
    log(`· ${schema}.clients: no existe, salto (módulo clients no instalado en este tenant)`);
    return false;
  }

  // ── client_attachments ────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "client_attachments"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."client_attachments" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
        original_name VARCHAR(255) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size INTEGER NOT NULL CHECK (file_size >= 0),
        uploaded_by VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
      `,
      { transaction: t }
    );
    log(`✓ ${schema}.client_attachments: tabla creada`);
  } else {
    log(`· ${schema}.client_attachments: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "client_attachments_client_id_idx"))) {
    await s.query(
      `CREATE INDEX "client_attachments_client_id_idx" ON "${schema}"."client_attachments" (client_id)`,
      { transaction: t }
    );
    log(`✓ ${schema} index client_attachments_client_id_idx: creado`);
  } else {
    log(`· ${schema} index client_attachments_client_id_idx: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "client_attachments_created_at_idx"))) {
    await s.query(
      `CREATE INDEX "client_attachments_created_at_idx" ON "${schema}"."client_attachments" (created_at DESC)`,
      { transaction: t }
    );
    log(`✓ ${schema} index client_attachments_created_at_idx: creado`);
  } else {
    log(`· ${schema} index client_attachments_created_at_idx: ya existe`);
  }

  // ── client_notes ──────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "client_notes"))) {
    await s.query(
      `
      CREATE TABLE "${schema}"."client_notes" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
      `,
      { transaction: t }
    );
    log(`✓ ${schema}.client_notes: tabla creada`);
  } else {
    log(`· ${schema}.client_notes: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "client_notes_client_id_idx"))) {
    await s.query(
      `CREATE INDEX "client_notes_client_id_idx" ON "${schema}"."client_notes" (client_id)`,
      { transaction: t }
    );
    log(`✓ ${schema} index client_notes_client_id_idx: creado`);
  } else {
    log(`· ${schema} index client_notes_client_id_idx: ya existe`);
  }

  if (!(await indexExists(s, t, schema, "client_notes_created_at_idx"))) {
    await s.query(
      `CREATE INDEX "client_notes_created_at_idx" ON "${schema}"."client_notes" (created_at DESC)`,
      { transaction: t }
    );
    log(`✓ ${schema} index client_notes_created_at_idx: creado`);
  } else {
    log(`· ${schema} index client_notes_created_at_idx: ya existe`);
  }

  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function fetchTenantsWithClients(s) {
  const [rows] = await s.query(`
    SELECT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE tm.module_key = 'clients' AND tm.enabled = true
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: client_attachments + client_notes        \n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    header("Obteniendo tenants con módulo clients habilitado...");
    const slugs = await fetchTenantsWithClients(sequelize);
    if (slugs.length === 0) {
      log("· Ningún tenant tiene el módulo clients habilitado. Nada que hacer.");
      await sequelize.close();
      process.exit(0);
    }
    log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

    header("Creando tablas e índices (transacción global)...");
    const processed = [];
    await sequelize.transaction(async (t) => {
      for (const slug of slugs) {
        const schema = `crm_${slug}`;
        process.stdout.write(`\n· Schema ${schema}\n`);
        const ok = await processSchemaInTx(sequelize, t, schema);
        if (ok) processed.push(schema);
      }
    });

    process.stdout.write("\n══════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("══════════════════════════════════════════════════════\n");
    process.stdout.write(` ℹ Schemas afectados: ${processed.join(", ") || "(ninguno)"}\n`);
    process.stdout.write("══════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
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
