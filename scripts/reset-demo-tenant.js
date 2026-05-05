/**
 * reset-demo-tenant.js
 *
 * Reset reproducible del tenant `demo` para sprints de QA.
 *
 * Operación:
 *   1. Guards de seguridad: solo opera sobre `demo`, refuse en producción y
 *      ante DATABASE_URL sospechoso. Sin --confirm es DRY RUN.
 *   2. Cuenta filas existentes en las tablas principales (snapshot ANTES).
 *   3. SET session_replication_role = replica (desactiva triggers y FKs).
 *   4. TRUNCATE TABLE crm_demo.<todas> RESTART IDENTITY CASCADE en una sola
 *      sentencia.
 *   5. Restaura session_replication_role = DEFAULT.
 *   6. Recrea explícitamente las dos filas que el sistema asume que
 *      existen aunque el seed de billing las recupera por su lado:
 *        - invoice_series F (default, normal)
 *        - invoice_series R (rectificative)
 *      tenant_billing_settings y board_columns no se recrean aquí: el
 *      seed-billing-demo crea la fila de settings y los seeds de proyectos
 *      crean BoardColumns para cada proyecto que generan.
 *   7. Ejecuta los seeds en orden:
 *        - seed-team-demo.js
 *        - add-leads-module-demo.js  (siembra ~35 leads)
 *        - seed-billing-demo.js
 *        - add-training-module-demo.js
 *        - seed-cuestionarios-demo.js
 *        - seed-projects-demo.js
 *      No re-ejecutamos seed-demo.js (el script "show-room" general) porque
 *      crea clientes propios y los demás seeds dependen de ellos. Para los
 *      QA queremos partir del set mínimo coherente: equipo + leads + billing
 *      + training + cuestionarios + proyectos.
 *      OJO: seed-billing-demo asume que ya hay clientes. Por eso, antes de
 *      lanzar el seed de billing creamos un set mínimo de 6 clientes.
 *   8. Cuenta filas DESPUÉS de los seeds.
 *   9. Crea/actualiza 4 cuentas de prueba en master.users con passwords
 *      aleatorias generadas con crypto.randomBytes. Las imprime una sola
 *      vez en stdout.
 *
 * Uso:
 *   npm run db:reset:demo:dry-run   # imprime plan sin tocar nada
 *   npm run db:reset:demo           # con --confirm, ejecuta todo
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

// ─── Guards de seguridad ─────────────────────────────────────────────────────

const SLUG = process.env.TENANT_SLUG_FOR_RESET ?? "demo";
if (SLUG !== "demo") {
  throw new Error("Este script SOLO opera sobre el tenant 'demo'");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Reset BLOQUEADO en producción");
}

const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL) {
  throw new Error("DATABASE_URL no configurada");
}
if (DB_URL.includes("@db:") || DB_URL.includes("crm-salamandra-db")) {
  throw new Error("DATABASE_URL parece apuntar a producción. Reset bloqueado");
}

const CONFIRM = process.argv.includes("--confirm");
const SCHEMA = `crm_${SLUG}`;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Tablas a contar (no es la lista completa del schema, es la representativa
// para el snapshot ANTES/DESPUÉS).
const TABLES_TO_COUNT = [
  "team_members",
  "clients",
  "leads",
  "projects",
  "phases",
  "milestones",
  "board_columns",
  "project_members",
  "project_templates",
  "tasks",
  "invoices",
  "costs",
  "payments",
  "recurring_invoices",
  "courses",
  "course_enrollments",
  "companies",
  "training_users",
  "quiz_attempts",
  "invoice_series",
  "tenant_billing_settings",
];

// Orden de los seeds: cada elemento es { script, args, env? }. Las
// dependencias entre módulos: master + tenant_modules ya existen
// (no se borran en master), team primero (no depende de nadie), después
// clientes mínimos manualmente, después billing (necesita clientes y
// team), después training, después cuestionarios y por último projects
// (que vincula un lead a un proyecto, así que mejor con leads ya cargados).
const SEEDS = [
  { script: "seed-team-demo.js", description: "Equipo (5 TeamMembers)" },
  { script: "add-leads-module-demo.js", description: "Leads (35 leads ficticios)" },
  // Antes de billing necesitamos algunos clientes. Los creamos directos
  // en BD (sin pasar por seed-demo, que pisa demasiado).
  { inline: "createMinimalClients", description: "Clientes mínimos (6)" },
  { script: "seed-billing-demo.js", description: "Facturación (facturas, cobros, costes)" },
  { script: "add-training-module-demo.js", description: "Formación (empresas, cursos, alumnos)" },
  { script: "seed-cuestionarios-demo.js", description: "Cuestionarios" },
  { script: "seed-projects-demo.js", description: "Proyectos Sprint 1 (4 + 2 plantillas)" },
];

const TEST_USERS = [
  {
    email: "admin@demo.salamandra",
    role: "admin",
    moduleAccess: ["all"],
    description: "Admin con acceso a todos los módulos",
  },
  {
    email: "lead@demo.salamandra",
    role: "user",
    moduleAccess: ["leads", "team", "projects", "billing", "training", "cuestionarios"],
    description: "User con módulos completos (rol user, no admin)",
  },
  {
    email: "observer@demo.salamandra",
    role: "user",
    moduleAccess: ["leads", "team"],
    description: "User con módulos limitados (no ve billing/projects)",
  },
  {
    email: "portal@demo.salamandra",
    // El rol "client" no existe en el ENUM de master.users (ver
    // models/master/User.model.js: superadmin/admin/manager/user).
    // Hoy el portal cliente (#17) NO está implementado, así que esta
    // cuenta queda creada como `user` con moduleAccess vacío. Cuando
    // exista el portal habrá que migrarla.
    role: "user",
    moduleAccess: [],
    description: "Placeholder para portal cliente (módulo aún no implementado)",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

function generatePassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "").slice(0, 12);
}

function fmtTable(rows, columns) {
  // rows: [{name, before, afterTruncate, afterSeeds}, ...]
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
  const sep = "  ";
  const hdr = columns.map((c, i) => c.label.padEnd(widths[i])).join(sep);
  const sepLine = columns.map((_, i) => "-".repeat(widths[i])).join(sep);
  const body = rows.map((r) => columns.map((c, i) => String(r[c.key] ?? "").padEnd(widths[i])).join(sep)).join("\n");
  return `${hdr}\n${sepLine}\n${body}`;
}

async function countAllTables(sequelize) {
  const counts = {};
  for (const t of TABLES_TO_COUNT) {
    const [existsRows] = await sequelize.query(
      `SELECT 1 AS one FROM information_schema.tables
       WHERE table_schema = '${SCHEMA}' AND table_name = '${t}'`,
    );
    if (existsRows.length === 0) {
      counts[t] = "N/A";
      continue;
    }
    const [r] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}"."${t}"`);
    counts[t] = r[0].n;
  }
  return counts;
}

async function listAllTables(sequelize) {
  // Aliases the column to avoid a quirk: Sequelize PG returns rows with the
  // column "table_name" as a positional array instead of a hash. Aliasing
  // solves it.
  const [rows] = await sequelize.query(
    `SELECT table_name AS tn FROM information_schema.tables
     WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((r) => r.tn);
}

async function truncateAll(sequelize) {
  const tables = await listAllTables(sequelize);
  if (tables.length === 0) {
    log("· No hay tablas en el schema");
    return;
  }
  const list = tables.map((t) => `"${SCHEMA}"."${t}"`).join(", ");
  await sequelize.query(`SET session_replication_role = replica`);
  try {
    await sequelize.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    log(`✓ TRUNCATE de ${tables.length} tablas (RESTART IDENTITY CASCADE)`);
  } finally {
    await sequelize.query(`SET session_replication_role = DEFAULT`);
  }
}

async function alignSchemaQuirks(sequelize) {
  // Defensa en profundidad: la migración billing-rework antigua creaba
  // `invoice_series.kind` como VARCHAR(20). El bug ya está corregido en
  // migrate-billing-rework.js (la columna se crea como ENUM directamente)
  // y la sub-migración correctiva migrate-billing-fix-kind-enum.js arregla
  // los tenants que pasaron por la versión antigua. Tras ejecutar esa
  // sub-migración, este bloque debería ser un no-op en cualquier tenant
  // local. Lo mantenemos por defensividad: si alguien hace algo raro a
  // mano sobre el schema del demo, el reset lo deja consistente igualmente.
  await sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'enum_invoice_series_kind' AND n.nspname = '${SCHEMA}'
      ) THEN
        CREATE TYPE "${SCHEMA}"."enum_invoice_series_kind"
          AS ENUM ('normal', 'rectificative');
      END IF;
    END$$;
  `);
  // Si la columna sigue siendo varchar, convertirla
  const [rows] = await sequelize.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = '${SCHEMA}' AND table_name = 'invoice_series' AND column_name = 'kind'
  `);
  if (rows[0]?.data_type !== "USER-DEFINED") {
    await sequelize.query(`
      ALTER TABLE "${SCHEMA}"."invoice_series" ALTER COLUMN "kind" DROP DEFAULT;
      ALTER TABLE "${SCHEMA}"."invoice_series"
        ALTER COLUMN "kind" TYPE "${SCHEMA}"."enum_invoice_series_kind"
        USING "kind"::"${SCHEMA}"."enum_invoice_series_kind";
      ALTER TABLE "${SCHEMA}"."invoice_series" ALTER COLUMN "kind" SET DEFAULT 'normal';
    `);
    log("✓ invoice_series.kind alineada a ENUM (era VARCHAR)");
  } else {
    log("· invoice_series.kind ya era ENUM");
  }
}

async function recreateCriticalRows(sequelize) {
  const year = new Date().getFullYear();
  // F (normal) y R (rectificative) — el código asume que existen
  await sequelize.query(
    `INSERT INTO "${SCHEMA}"."invoice_series"
       (code, name, prefix, year, next_number, is_default, kind, created_at, updated_at)
     VALUES ('F', 'Facturas ordinarias', 'F', ${year}, 1, true, 'normal', NOW(), NOW())
     ON CONFLICT (code) DO NOTHING`,
  );
  await sequelize.query(
    `INSERT INTO "${SCHEMA}"."invoice_series"
       (code, name, prefix, year, next_number, is_default, kind, created_at, updated_at)
     VALUES ('R', 'Facturas rectificativas', 'R', ${year}, 1, false, 'rectificative', NOW(), NOW())
     ON CONFLICT (code) DO NOTHING`,
  );
  log("✓ Recreadas series F y R");
}

async function createMinimalClients(tenantSlug) {
  const { models } = getTenantDb(tenantSlug);
  const { Client } = models;
  const samples = [
    { name: "Quality Energy Consulting", taxId: "B11111111", fiscalName: "Quality Energy Consulting S.L.",
      fiscalAddress: "Av. Energía 1", fiscalCity: "Madrid", fiscalZip: "28001", fiscalCountry: "ES",
      email: "contacto@qualityenergy.com", phone: "+34 600 100 001" },
    { name: "Innovatech Solutions", taxId: "B22222222", fiscalName: "Innovatech Solutions S.L.",
      fiscalAddress: "Calle Innovación 12", fiscalCity: "Barcelona", fiscalZip: "08001", fiscalCountry: "ES",
      email: "contacto@innovatech.com", phone: "+34 600 100 002" },
    { name: "Distribuciones Marbella", taxId: "B33333333", fiscalName: "Distribuciones Marbella S.A.",
      fiscalAddress: "Polígono Industrial 5", fiscalCity: "Málaga", fiscalZip: "29001", fiscalCountry: "ES",
      email: "contacto@distmarbella.com", phone: "+34 600 100 003" },
    { name: "Consultora Atlántica", taxId: "B44444444", fiscalName: "Consultora Atlántica S.L.",
      fiscalAddress: "Calle Atlántico 8", fiscalCity: "Sevilla", fiscalZip: "41001", fiscalCountry: "ES",
      email: "contacto@atlantica.com", phone: "+34 600 100 004" },
    { name: "TecnoIberia S.A.", taxId: "B55555555", fiscalName: "TecnoIberia S.A.",
      fiscalAddress: "Paseo Tecnología 21", fiscalCity: "Valencia", fiscalZip: "46001", fiscalCountry: "ES",
      email: "contacto@tecnoiberia.com", phone: "+34 600 100 005" },
    { name: "Grupo Vértice", taxId: "B66666666", fiscalName: "Grupo Vértice S.L.",
      fiscalAddress: "Calle Vértice 3", fiscalCity: "Bilbao", fiscalZip: "48001", fiscalCountry: "ES",
      email: "contacto@grupovertice.com", phone: "+34 600 100 006" },
  ];
  for (const s of samples) {
    await Client.findOrCreate({
      where: { taxId: s.taxId },
      defaults: { ...s, customFields: { source: "qa-reset" } },
    });
  }
  log(`✓ ${samples.length} clientes mínimos creados (con datos fiscales completos)`);
}

function runSeedScript(scriptName) {
  const scriptPath = join(__dirname, scriptName);
  log(`▷ ejecutando ${scriptName}...`);
  const result = spawnSync(
    process.execPath,
    ["--env-file=.env.local", scriptPath],
    { stdio: "inherit", cwd: join(__dirname, "..") },
  );
  if (result.status !== 0) {
    throw new Error(`Seed ${scriptName} falló con código ${result.status}`);
  }
}

async function ensureTestUsers(tenantId) {
  const { User } = getMasterModels();
  const credentials = [];
  for (const spec of TEST_USERS) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await User.findOne({ where: { email: spec.email } });
    if (existing) {
      await existing.update({
        passwordHash,
        role: spec.role,
        tenantId,
        moduleAccess: spec.moduleAccess,
      });
      credentials.push({ ...spec, password, status: "actualizado" });
    } else {
      await User.create({
        email: spec.email,
        passwordHash,
        role: spec.role,
        tenantId,
        moduleAccess: spec.moduleAccess,
      });
      credentials.push({ ...spec, password, status: "creado" });
    }
  }
  return credentials;
}

// ─── Plan / dry-run ──────────────────────────────────────────────────────────

function printPlan() {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" RESET tenant 'demo' — PLAN (DRY RUN)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");
  process.stdout.write("1. SET session_replication_role = replica\n");
  process.stdout.write(`2. TRUNCATE de TODAS las tablas en schema "${SCHEMA}" RESTART IDENTITY CASCADE\n`);
  process.stdout.write("3. SET session_replication_role = DEFAULT\n");
  process.stdout.write("4. Recrea filas críticas: invoice_series F y R\n");
  process.stdout.write("5. Ejecuta seeds en orden:\n");
  for (const s of SEEDS) {
    process.stdout.write(`   - ${s.script ?? `(inline:${s.inline})`}: ${s.description}\n`);
  }
  process.stdout.write("6. Crea/actualiza cuentas de prueba en master.users:\n");
  for (const u of TEST_USERS) {
    process.stdout.write(`   - ${u.email.padEnd(32)} role=${u.role.padEnd(10)} ${u.description}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write("Ningún cambio realizado. Para ejecutar de verdad: añade --confirm\n\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!CONFIRM) {
    printPlan();
    process.exit(0);
  }

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" RESET tenant 'demo' — EJECUCIÓN\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  // Verificar tenant
  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    throw new Error("Tenant demo no encontrado en master.tenants. Ejecuta db:sync primero.");
  }

  const { sequelize } = getTenantDb(SLUG);

  // 1. Snapshot ANTES
  header("Contando filas ANTES del reset...");
  const before = await countAllTables(sequelize);
  log("Snapshot capturado");

  // 2. TRUNCATE
  header(`Truncando todas las tablas en ${SCHEMA}...`);
  await truncateAll(sequelize);

  // Snapshot post-truncate
  const afterTruncate = await countAllTables(sequelize);

  // 3. Alinear quirks de schema vs modelo (antes de cualquier sync alter)
  header("Alineando quirks de schema vs modelo...");
  await alignSchemaQuirks(sequelize);

  // 4. Recrear filas críticas
  header("Recreando filas críticas...");
  await recreateCriticalRows(sequelize);

  invalidateTenantCache(SLUG);

  // 4. Cerrar conexiones del pool — los seeds abrirán las suyas
  await closeAllConnections();

  // 5. Ejecutar seeds en orden
  header("Ejecutando seeds en orden...");
  for (const s of SEEDS) {
    if (s.script) {
      runSeedScript(s.script);
    } else if (s.inline === "createMinimalClients") {
      await createMinimalClients(SLUG);
      // tras inline, cerrar para que los seeds posteriores tengan conexión limpia
      await closeAllConnections();
    }
  }

  // 6. Snapshot DESPUÉS
  header("Contando filas DESPUÉS de los seeds...");
  const { sequelize: seq2 } = getTenantDb(SLUG);
  const afterSeeds = await countAllTables(seq2);

  // 7. Cuentas de prueba
  header("Creando/actualizando cuentas de prueba en master.users...");
  const credentials = await ensureTestUsers(tenant.id);

  // 8. Reporte final
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" RESULTADO DEL RESET\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");

  const rows = TABLES_TO_COUNT.map((t) => ({
    table: t,
    antes: before[t],
    truncate: afterTruncate[t],
    despues: afterSeeds[t],
  }));
  process.stdout.write(fmtTable(rows, [
    { key: "table", label: "tabla" },
    { key: "antes", label: "ANTES" },
    { key: "truncate", label: "TRUNCATE" },
    { key: "despues", label: "DESPUÉS" },
  ]));
  process.stdout.write("\n");

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" CUENTAS DE PRUEBA (copiar al checklist — 1 sola vez en stdout)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");
  for (const c of credentials) {
    process.stdout.write(`  ${c.email.padEnd(32)} / ${c.password}    [${c.status}, role=${c.role}]\n`);
  }
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  process.stdout.write("\nLogins disponibles para QA (master.users con tenantId=demo):\n");
  for (const c of credentials) {
    const mods = c.moduleAccess.length === 0 ? "(ninguno)" : c.moduleAccess.join(", ");
    process.stdout.write(`  ${c.email.padEnd(32)} role=${c.role.padEnd(8)} módulos=${mods}\n`);
  }
  process.stdout.write("\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
