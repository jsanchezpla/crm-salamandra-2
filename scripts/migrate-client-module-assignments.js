/**
 * migrate-client-module-assignments.js — Sprint "Clientes ↔ módulos".
 *
 * Para CADA tenant con el módulo `clients` activo (lista leída de
 * master.tenants JOIN master.tenant_modules en runtime — regla #12):
 *
 *   Fase B (transacción por-tenant, idempotente):
 *     - CREATE TABLE IF NOT EXISTS client_module_assignments (FK → clients CASCADE,
 *       UNIQUE(client_id, module_key)).
 *     - Si existe la tabla `patients` (tenants con clinica/pacientes): AÑADE
 *       patients.client_id UUID nullable + FK → clients(id) ON DELETE SET NULL
 *       (materialización de "Paciente Clínica").
 *
 *   Fase C (solo crm_nutri_laura): backfill del módulo `nutricion` a los clients
 *     que YA son pacientes hoy (tienen un plan asignado activo, o proceden de
 *     conversión lead→paciente: custom_fields->>'origin'='lead'). Idempotente
 *     (ON CONFLICT DO NOTHING); no marca los clients dados de alta a mano.
 *
 * Nunca db:sync. SQL crudo idempotente. Un fallo en un tenant no aborta el resto.
 *
 * ⚠️ ORDEN DE DEPLOY (IMPORTANTE): esta migración es FORWARD-COMPATIBLE (solo
 * AÑADE tabla + columna nullable que el código viejo ignora). El modelo nuevo
 * Patient.clientId hace que TODA lectura de Patient seleccione patients.client_id,
 * así que si se despliega la app nueva ANTES de migrar, los endpoints de
 * Pacientes/Clínica de un tenant con datos (aumenta) rompen con 42703 hasta que
 * se corra el script. Por eso, en el VPS, ejecutar la migración ANTES de
 * `deploy.sh` (contra el contenedor actual, ya en marcha):
 *
 *   git pull
 *   docker exec crm-salamandra-app-1 node scripts/migrate-client-module-assignments.js
 *   ./deploy.sh
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-client-module-assignments.js
 */

import crypto from "node:crypto";
import { Sequelize } from "sequelize";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Introspección ──────────────────────────────────────────────────────────

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}
async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
    transaction: t,
  });
  return rows.length > 0;
}
async function constraintExists(s, t, schema, table, constraintName) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = $1 AND table_name = $2 AND constraint_name = $3`,
    { bind: [schema, table, constraintName], transaction: t }
  );
  return rows.length > 0;
}

async function fetchTargetSlugs(s) {
  const [rows] = await s.query(`
    SELECT DISTINCT t.slug
    FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key = 'clients'
    ORDER BY t.slug
  `);
  return rows.map((r) => r.slug);
}

// gen_random_uuid(): nativa desde PG13; PG12 vía pgcrypto. Si no se garantiza,
// se omite el DEFAULT y el id se genera en JS (Sequelize/este script).
async function ensureUuidFn(s) {
  try {
    await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    /* sin permiso — seguimos e intentamos detectar */
  }
  try {
    await s.query(`SELECT gen_random_uuid()`);
    return true;
  } catch {
    return false;
  }
}

async function ensureIndex(s, t, schema, indexName, table, colsSql, unique = false) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX "${indexName}" ON "${schema}"."${table}" ${colsSql}`,
    { transaction: t }
  );
  log(`✓ ${schema} index ${indexName}: creado`);
}

// ─── Fase B: tabla + columna patients.client_id ─────────────────────────────

async function ensureSchemaObjects(s, t, schema, uuidDefault) {
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  // ── client_module_assignments ──
  if (!(await tableExists(s, t, schema, "client_module_assignments"))) {
    await s.query(
      `CREATE TABLE "${schema}"."client_module_assignments" (
        ${idCol},
        client_id UUID NOT NULL REFERENCES "${schema}"."clients"(id) ON DELETE CASCADE,
        module_key VARCHAR(50) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        assigned_at TIMESTAMPTZ,
        assigned_by_user_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    log(`✓ ${schema}.client_module_assignments: tabla creada`);
  }
  await ensureIndex(s, t, schema, "cma_client_module_unique", "client_module_assignments", "(client_id, module_key)", true);
  await ensureIndex(s, t, schema, "cma_module_enabled_idx", "client_module_assignments", "(module_key, enabled)");

  // ── patients.client_id (solo si el tenant tiene el módulo clínica/pacientes) ──
  if (await tableExists(s, t, schema, "patients")) {
    if (!(await columnExists(s, t, schema, "patients", "client_id"))) {
      await s.query(`ALTER TABLE "${schema}"."patients" ADD COLUMN client_id UUID`, { transaction: t });
      log(`✓ ${schema}.patients: columna client_id añadida`);
    }
    if (!(await constraintExists(s, t, schema, "patients", "patients_client_id_fkey"))) {
      await s.query(
        `ALTER TABLE "${schema}"."patients"
         ADD CONSTRAINT patients_client_id_fkey
         FOREIGN KEY (client_id) REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}.patients: FK client_id → clients añadida`);
    }
    // Índice ÚNICO parcial: un Client materializa como mucho un Patient. Además
    // de dedup (evita 2 pacientes por cliente en una carrera de doble marcado),
    // sirve de índice de búsqueda por client_id. WHERE client_id IS NOT NULL para
    // no colisionar entre los pacientes históricos sin cliente enlazado.
    if (!(await indexExists(s, t, schema, "patients_client_unique"))) {
      await s.query(
        `CREATE UNIQUE INDEX "patients_client_unique" ON "${schema}"."patients" (client_id) WHERE client_id IS NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}.patients: índice único parcial patients_client_unique creado`);
    }
  } else {
    log(`· ${schema}: sin tabla patients (tenant sin clínica) — se omite patients.client_id`);
  }
}

// ─── Fase C: backfill nutricion (solo nutri_laura) ──────────────────────────

async function backfillNutrition(s, schema) {
  if (!(await tableExists(s, null, schema, "plans"))) {
    log(`· ${schema}: sin tabla plans — se omite backfill nutricion`);
    return;
  }
  // Candidatos = pacientes de hoy: plan asignado activo O procedencia lead.
  // Excluye los ya asignados (idempotente incluso sin ON CONFLICT).
  const [candidates] = await s.query(`
    SELECT c.id,
      COALESCE(
        (SELECT MIN(p.assigned_at) FROM "${schema}"."plans" p
          WHERE p.client_id = c.id AND p.type = 'assigned' AND p.archived_at IS NULL),
        c.created_at) AS assigned_at
    FROM "${schema}"."clients" c
    WHERE (
      EXISTS (SELECT 1 FROM "${schema}"."plans" p
              WHERE p.client_id = c.id AND p.type = 'assigned' AND p.archived_at IS NULL)
      OR (c.custom_fields->>'origin') = 'lead'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "${schema}"."client_module_assignments" a
      WHERE a.client_id = c.id AND a.module_key = 'nutricion'
    )
  `);
  // Atómico: o se insertan todos los candidatos o ninguno (evita estado a
  // medias si algo falla a mitad del bucle).
  await s.transaction(async (t) => {
    for (const row of candidates) {
      await s.query(
        `INSERT INTO "${schema}"."client_module_assignments"
          (id, client_id, module_key, enabled, assigned_at, metadata, created_at, updated_at)
         VALUES ($1, $2, 'nutricion', TRUE, $3, '{"backfill":true}'::jsonb, now(), now())
         ON CONFLICT (client_id, module_key) DO NOTHING`,
        { bind: [crypto.randomUUID(), row.id, row.assigned_at], transaction: t }
      );
    }
  });
  log(`✓ ${schema}: backfill nutricion — ${candidates.length} candidato(s) (plan asignado / origen lead)`);
}

async function processSchema(s, schema, isNutriLaura) {
  if (!(await tableExists(s, null, schema, "clients"))) {
    log(`✗ ${schema}: no existe tabla clients. Se salta este tenant.`);
    return;
  }
  const uuidDefault = await ensureUuidFn(s);
  await s.transaction(async (t) => {
    await ensureSchemaObjects(s, t, schema, uuidDefault);
  });
  if (isNutriLaura) {
    await backfillNutrition(s, schema);
  }
  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Clientes ↔ módulos (client_module_assignments)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchTargetSlugs(sequelize);
  if (slugs.length === 0) {
    log("· Ningún tenant con módulo clients activo.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length} tenants: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
    if (!(await schemaExists(sequelize, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(sequelize, schema, slug === "nutri_laura");
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
