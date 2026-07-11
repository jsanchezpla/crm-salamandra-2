/**
 * migrate-outreach-sprint-1.js
 *
 * Crea las tablas del módulo Outreach (captación de leads) en los tenants con
 * el módulo `outreach` activo:
 *
 *   outreach_business_lines  líneas de negocio del tenant contra las que se puntúa
 *   outreach_leads           empresas captadas, aún sin contactar
 *   outreach_contacts        personas dentro de cada empresa
 *   outreach_analyses        análisis IA (uno por lead × línea de negocio)
 *   outreach_settings        ajustes del módulo (modelo IA, contexto, regla)
 *
 * El prefijo `outreach_` NO es cosmético: sin él, `outreach_leads` chocaría con
 * la tabla `leads` que el módulo comercial del CRM ya tiene en cada schema de
 * tenant (PK UUID, columnas distintas). Son entidades independientes.
 *
 * - Lee la lista de tenants con `outreach` habilitado desde master.tenant_modules
 *   en runtime (nunca hardcode; difiere local↔prod).
 * - Idempotente: CREATE TABLE / INDEX con guardas de existencia.
 * - Por schema independiente (sin transacción global): si uno falla, los demás
 *   siguen. Los nombres de índice coinciden con los que generaría
 *   sequelize.sync() para tenants nuevos, evitando divergencia sync↔migración.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-outreach-sprint-1.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-outreach-sprint-1.js
 */

import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function indexExists(s, schema, indexName) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
    { bind: [schema, indexName] }
  );
  return rows.length > 0;
}

/**
 * `gen_random_uuid()` es nativa desde PostgreSQL 13. El Postgres local de
 * desarrollo es un 12 (el que trae Odoo), donde la aporta la extensión
 * pgcrypto. Producción corre PG16 y no necesita nada.
 *
 * Devuelve la cláusula DEFAULT a usar, o "" si la función no está disponible:
 * en ese caso Sequelize genera el UUID en JS (DataTypes.UUIDV4), así que las
 * tablas siguen siendo correctas, solo pierden el default a nivel de BD.
 */
async function resolveUuidDefault(s) {
  const works = async () => {
    try { await s.query("SELECT gen_random_uuid()"); return true; } catch { return false; }
  };
  if (await works()) return "DEFAULT gen_random_uuid()";
  try { await s.query("CREATE EXTENSION IF NOT EXISTS pgcrypto"); } catch { /* sin permisos */ }
  if (await works()) return "DEFAULT gen_random_uuid()";
  return "";
}

const TABLES = [
  {
    name: "outreach_business_lines",
    ddl: (schema, uuid) => `
      CREATE TABLE "${schema}"."outreach_business_lines" (
        id UUID PRIMARY KEY ${uuid},
        "key" VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        scoring_up JSONB NOT NULL DEFAULT '[]'::jsonb,
        scoring_down JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
  {
    name: "outreach_leads",
    ddl: (schema, uuid) => `
      CREATE TABLE "${schema}"."outreach_leads" (
        id UUID PRIMARY KEY ${uuid},
        name VARCHAR(255) NOT NULL,
        sector VARCHAR(255),
        location VARCHAR(255),
        website VARCHAR(255),
        phone VARCHAR(255),
        email VARCHAR(255),
        source VARCHAR(64) NOT NULL DEFAULT 'manual',
        source_url TEXT,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        analyzed BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
  {
    name: "outreach_contacts",
    ddl: (schema, uuid) => `
      CREATE TABLE "${schema}"."outreach_contacts" (
        id UUID PRIMARY KEY ${uuid},
        outreach_lead_id UUID NOT NULL
          REFERENCES "${schema}"."outreach_leads"(id) ON DELETE CASCADE,
        name VARCHAR(255),
        "role" VARCHAR(255),
        phone VARCHAR(255),
        mobile VARCHAR(255),
        email VARCHAR(255),
        linkedin VARCHAR(255),
        is_decision_maker BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
  {
    name: "outreach_analyses",
    ddl: (schema, uuid) => `
      CREATE TABLE "${schema}"."outreach_analyses" (
        id UUID PRIMARY KEY ${uuid},
        outreach_lead_id UUID NOT NULL
          REFERENCES "${schema}"."outreach_leads"(id) ON DELETE CASCADE,
        business_line_id UUID NOT NULL
          REFERENCES "${schema}"."outreach_business_lines"(id) ON DELETE CASCADE,
        score INTEGER CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
        reason_why TEXT,
        needs JSONB NOT NULL DEFAULT '[]'::jsonb,
        pitch TEXT,
        email_draft JSONB,
        sent_at TIMESTAMPTZ,
        analyzed_at TIMESTAMPTZ,
        "model" VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
  {
    name: "outreach_settings",
    ddl: (schema, uuid) => `
      CREATE TABLE "${schema}"."outreach_settings" (
        id UUID PRIMARY KEY ${uuid},
        ai_model VARCHAR(64) NOT NULL DEFAULT 'claude-opus-4-8',
        company_context TEXT,
        chaining_rule TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
  },
];

const INDEXES = [
  {
    name: "outreach_business_lines_sort_idx",
    ddl: (s) => `CREATE INDEX "outreach_business_lines_sort_idx" ON "${s}"."outreach_business_lines"(sort_order)`,
  },
  {
    name: "outreach_leads_dedupe_key",
    ddl: (s) => `CREATE UNIQUE INDEX "outreach_leads_dedupe_key" ON "${s}"."outreach_leads"(name, location, source)`,
  },
  {
    name: "outreach_leads_sector_idx",
    ddl: (s) => `CREATE INDEX "outreach_leads_sector_idx" ON "${s}"."outreach_leads"(sector)`,
  },
  {
    name: "outreach_leads_analyzed_idx",
    ddl: (s) => `CREATE INDEX "outreach_leads_analyzed_idx" ON "${s}"."outreach_leads"(analyzed)`,
  },
  {
    name: "outreach_contacts_lead_idx",
    ddl: (s) => `CREATE INDEX "outreach_contacts_lead_idx" ON "${s}"."outreach_contacts"(outreach_lead_id)`,
  },
  {
    name: "outreach_analyses_lead_line_key",
    ddl: (s) => `CREATE UNIQUE INDEX "outreach_analyses_lead_line_key" ON "${s}"."outreach_analyses"(outreach_lead_id, business_line_id)`,
  },
  {
    name: "outreach_analyses_score_idx",
    ddl: (s) => `CREATE INDEX "outreach_analyses_score_idx" ON "${s}"."outreach_analyses"(score)`,
  },
];

async function processSchema(s, schema, uuid) {
  const result = { tenant: schema.replace(/^crm_/, ""), tables: 0, indexes: 0 };

  // Orden importante: las FK exigen que existan primero leads y business_lines.
  for (const t of TABLES) {
    if (await tableExists(s, schema, t.name)) continue;
    await s.query(t.ddl(schema, uuid));
    result.tables++;
  }

  for (const i of INDEXES) {
    if (await indexExists(s, schema, i.name)) continue;
    await s.query(i.ddl(schema));
    result.indexes++;
  }

  return result;
}

async function fetchOutreachSlugs(s) {
  const [rows] = await s.query(`
    SELECT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.module_key = 'outreach' AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Outreach (captación) — Sprint 1      \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const uuidDefault = await resolveUuidDefault(sequelize);
  if (!uuidDefault) log("⚠ gen_random_uuid() no disponible: las PK se crean sin DEFAULT (Sequelize genera el UUID).");

  header("Tenants con módulo outreach activo...");
  const slugs = await fetchOutreachSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con outreach. Actívalo en master.tenant_modules y vuelve a lanzar.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    process.stdout.write(`\n· Schema ${schema}\n`);
    try {
      const r = await processSchema(sequelize, schema, uuidDefault);
      log(`  tablas nuevas: ${r.tables}/${TABLES.length} · índices nuevos: ${r.indexes}/${INDEXES.length}`);
    } catch (err) {
      log(`  ✗ Error en ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada                          \n");
  process.stdout.write("════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
