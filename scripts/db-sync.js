/**
 * db-sync.js — Inicialización de la base de datos
 *
 * Crea los schemas, tablas y datos de demo necesarios para arrancar el proyecto.
 * Es idempotente: se puede ejecutar varias veces sin romper nada.
 *
 * Uso: npm run db:sync
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const DEMO_SLUG = "demo";
const DEMO_ADMIN_EMAIL = "admin@demo.salamandra";
const DEMO_ADMIN_PASSWORD = "Admin1234!";

const ALL_MODULES = [
  "clients",
  "sales",
  "projects",
  "support",
  "billing",
  "team",
  "planning",
  "documents",
  "inventory",
  "training",
  "automations",
  "ai",
  "integrations",
  "analytics",
  "communications",
  "client_portal",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function createSchemaIfNotExists(sequelize, schemaName) {
  await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  log(`✓ Schema "${schemaName}"`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Salamandra CRM — Inicialización de BD  \n");
  process.stdout.write("════════════════════════════════════════\n");

  // Conexión raw para crear schemas (sin schema fijo)
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  // ── 1. Schemas ─────────────────────────────────────────────────────────────
  header("Creando schemas...");
  await createSchemaIfNotExists(rawDb, "master");
  await createSchemaIfNotExists(rawDb, `crm_${DEMO_SLUG}`);
  await rawDb.close();

  // ── 2. Tablas del schema master ────────────────────────────────────────────
  header("Sincronizando tablas del schema master...");
  const masterDb = getMasterDb();
  await masterDb.sync({ force: false });
  log("✓ Tenant, User, TenantModule, AuditLog");

  // ── 3. Tablas del schema tenant demo ───────────────────────────────────────
  header(`Sincronizando tablas del schema crm_${DEMO_SLUG}...`);
  const { sequelize: tenantDb } = getTenantDb(DEMO_SLUG);
  await tenantDb.sync({ force: false });
  log("✓ Client, Contact, Lead, Project, Task, Ticket, Invoice...");

  // ── 4. Datos de demo ────────────────────────────────────────────────────────
  header("Creando datos de demo...");
  const { Tenant, User, TenantModule } = getMasterModels();

  // Tenant demo
  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: DEMO_SLUG },
    defaults: {
      name: "Empresa Demo",
      slug: DEMO_SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#1B3A2D",
          secondaryColor: "#FAFAF8",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existe"} tenant "${DEMO_SLUG}" (id: ${tenant.id})`);

  // Usuario administrador
  const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
  const [, userCreated] = await User.findOrCreate({
    where: { email: DEMO_ADMIN_EMAIL },
    defaults: {
      email: DEMO_ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ALL_MODULES,
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existe"} usuario "${DEMO_ADMIN_EMAIL}"`);

  // Módulos del tenant — todos activados en demo
  let modulesCreated = 0;
  for (const moduleKey of ALL_MODULES) {
    const [, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id,
        moduleKey,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        featureFlags: {},
      },
    });
    if (created) modulesCreated++;
  }
  log(`✓ Módulos: ${modulesCreated} creados, ${ALL_MODULES.length - modulesCreated} ya existían`);

  // ── 5. Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Credenciales de acceso demo:\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  URL:        http://localhost:3000/login\n`);
  process.stdout.write(`  Tenant:     x-tenant: ${DEMO_SLUG}  (o subdominio demo.*)\n`);
  process.stdout.write(`  Email:      ${DEMO_ADMIN_EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${DEMO_ADMIN_PASSWORD}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
