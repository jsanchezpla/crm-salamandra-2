/**
 * seed-spain-enzymes.js — Inicializa el tenant Spain Enzymes
 *
 * 1. Crea schema crm_spain_enzymes
 * 2. Crea el tenant, usuario admin y módulo leads
 *
 * Uso local:  node --env-file=.env.local scripts/seed-spain-enzymes.js
 * Uso VPS:    docker compose exec app node scripts/seed-spain-enzymes.js
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

import { exigirTenantDePruebas } from "./_guard-datos-reales.js";

const SLUG = "spain_enzymes";
const SCHEMA = `crm_${SLUG}`;

// Frenado el 2026-08-07. Spain Enzymes está EN PRODUCCIÓN (se corrigió el
// 31/07: ya no es "solo local") y recibe leads reales del formulario de
// spainenzymes.com. El sync({alter:true}) de este script borra columnas vivas
// que el modelo no declara.
exigirTenantDePruebas(SLUG, {
  script: "seed-spain-enzymes.js",
  destruye:
    "siembra datos de ejemplo sobre un cliente en producción que recibe leads " +
    "de su web, y el sync({alter:true}) elimina columnas que el modelo no expone.",
});
const USER_EMAIL = "admin@spain-enzymes.salamandra";
const USER_PASSWORD = "SpainEnz#2026!";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write("      Spain Enzymes — Seed inicial          \n");
  process.stdout.write("════════════════════════════════════════════\n");

  // ── 1. Crear schema ────────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tablas master ────────────────────────────────────────────────────────
  header("Sincronizando tablas master...");
  getMasterDb();

  // ── 3. Tablas del tenant ────────────────────────────────────────────────────
  header(`Sincronizando tablas de ${SCHEMA}...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log(`✓ Tablas en ${SCHEMA} creadas`);

  // ── 4. Tenant ───────────────────────────────────────────────────────────────
  header("Creando tenant Spain Enzymes...");
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "Spain Enzymes",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#7B1E2C",
          secondaryColor: "#5C1620",
          accentColor: "#F8F1EA",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 5. Usuario ──────────────────────────────────────────────────────────────
  header("Creando usuario administrador...");
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 12);
  const [, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["leads"],
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existía"} usuario "${USER_EMAIL}"`);

  // ── 6. Módulo leads ─────────────────────────────────────────────────────────
  header('Registrando módulo "leads"...');
  const [, leadsCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "spain-enzymes/LeadsModule",
      schemaExtensions: {
        empresa: { type: "string" },
        pais: { type: "string" },
        ciudad: { type: "string" },
        asunto: { type: "string" },
        prioridad: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${leadsCreated ? "✓ Creado" : "· Ya existía"} módulo "leads"`);

  // ── 7. Módulo clients ───────────────────────────────────────────────────────
  header('Registrando módulo "clients"...');
  const [, clientsCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "clients" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "clients",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${clientsCreated ? "✓ Creado" : "· Ya existía"} módulo "clients"`);

  // ── 8. Módulo inventory ─────────────────────────────────────────────────────
  header('Registrando módulo "inventory"...');
  const [, inventoryCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "inventory" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "inventory",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${inventoryCreated ? "✓ Creado" : "· Ya existía"} módulo "inventory"`);

  // ── 7. Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Accede con estas credenciales:\n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  URL:        https://crm.salamandrasolutions.com/login\n`);
  process.stdout.write(`  Tenant:     x-tenant: ${SLUG}\n`);
  process.stdout.write(`  Email:      ${USER_EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${USER_PASSWORD}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
